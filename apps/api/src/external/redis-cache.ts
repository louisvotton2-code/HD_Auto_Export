import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createConnection, type Socket } from 'node:net';

export interface PublicCacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  close(): Promise<void>;
}
export type RedisPublicCacheOptions = {
  host: string; port: number; username: string; passwordFile: string;
  timeoutMs?: number; maxConnections?: number;
};
const unavailable = () => new Error('Public cache storage is unavailable.');
const encode = (parts: string[]) => Buffer.concat([
  Buffer.from(`*${parts.length}\r\n`),
  ...parts.flatMap(part => { const value = Buffer.from(part); return [Buffer.from(`$${value.length}\r\n`), value, Buffer.from('\r\n')]; }),
]);

/** Dedicated ACL: GET and SET on the namespace's fixed slot keys. No administrative commands. */
export async function createRedisPublicCacheStore(options: RedisPublicCacheOptions, maxValueBytes: number): Promise<PublicCacheStore> {
  if (!['127.0.0.1', 'redis-scale'].includes(options.host) || !Number.isInteger(options.port) || options.port < 1 || options.port > 65535 ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(options.username) || !Number.isInteger(maxValueBytes) || maxValueBytes < 1 || maxValueBytes > 1_048_576) throw unavailable();
  const file = await open(options.passwordFile, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => { throw unavailable(); });
  let password: string;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || ![0o400, 0o600].includes(info.mode & 0o777) || info.size < 1 || info.size > 4096) throw unavailable();
    const bytes = Buffer.alloc(4097);
    const read = await file.read(bytes, 0, bytes.length, 0);
    if (read.bytesRead > 4096) throw unavailable();
    password = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, read.bytesRead)).replace(/\r?\n$/, '');
    if (!password || /[\r\n\0]/.test(password)) throw unavailable();
  } catch { throw unavailable(); }
  finally { await file.close(); }
  const timeoutMs = options.timeoutMs ?? 250;
  const maxConnections = options.maxConnections ?? 8;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 2000 || !Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 16) throw unavailable();
  const sockets = new Set<Socket>();
  let closed = false;
  const command = (parts: string[]): Promise<string | null> => {
    if (closed || sockets.size >= maxConnections) return Promise.reject(unavailable());
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: options.host, port: options.port });
      sockets.add(socket);
      let pending = Buffer.alloc(0), authenticated = false, settled = false;
      const finish = (error: boolean, value: string | null = null) => {
        if (settled) return;
        settled = true; clearTimeout(timer); sockets.delete(socket); socket.destroy();
        if (error) reject(unavailable()); else resolve(value);
      };
      const timer = setTimeout(() => finish(true), timeoutMs);
      socket.setNoDelay(true);
      socket.once('error', () => finish(true));
      socket.once('close', () => finish(true));
      socket.once('connect', () => socket.write(encode(['AUTH', options.username, password])));
      socket.on('data', chunk => {
        if (pending.length + chunk.length > maxValueBytes + 1024) { finish(true); return; }
        pending = Buffer.concat([pending, chunk]);
        const lineEnd = pending.indexOf('\r\n');
        if (lineEnd < 0) { if (pending.length > 64) finish(true); return; }
        const line = pending.subarray(0, lineEnd).toString('ascii');
        let value: string | null, consumed = lineEnd + 2;
        if (line === '+OK') value = 'OK';
        else if (line === '$-1') value = null;
        else if (/^\$(?:0|[1-9][0-9]{0,7})$/.test(line)) {
          const size = Number(line.slice(1));
          if (size > maxValueBytes || !authenticated) { finish(true); return; }
          if (pending.length < consumed + size + 2) return;
          if (pending[consumed + size] !== 13 || pending[consumed + size + 1] !== 10) { finish(true); return; }
          try { value = new TextDecoder('utf-8', { fatal: true }).decode(pending.subarray(consumed, consumed + size)); }
          catch { finish(true); return; }
          consumed += size + 2;
        } else { finish(true); return; }
        if (pending.length !== consumed) { finish(true); return; }
        pending = Buffer.alloc(0);
        if (!authenticated) {
          if (value !== 'OK') { finish(true); return; }
          authenticated = true; socket.write(encode(parts));
        } else if ((parts[0] === 'SET' && value !== 'OK') || (parts[0] === 'GET' && line === '+OK')) finish(true);
        else finish(false, value);
      });
    });
  };
  return {
    get: key => command(['GET', key]),
    async set(key, value, ttlMs) {
      if (Buffer.byteLength(value) > maxValueBytes || !Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > 30_000) throw unavailable();
      await command(['SET', key, value, 'PX', String(ttlMs)]);
    },
    async close() { closed = true; for (const socket of sockets) socket.destroy(); },
  };
}
