import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, type Socket } from 'node:net';
import { chmod, link, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRedisPublicCacheStore } from './redis-cache.js';

async function secret(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), 'hd-public-cache-test-'));
  const file = path.join(dir, 'password');
  await writeFile(file, 'private-test-password\n', { mode: 0o600 });
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, file };
}
function parseCommand(bytes: Buffer): { parts: string[]; length: number } | null {
  const lines: string[] = [];
  let pos = 0;
  const line = () => { const end = bytes.indexOf('\r\n', pos); if (end < 0) return null; const value = bytes.subarray(pos, end).toString(); pos = end + 2; return value; };
  const count = line(); if (count === null) return null;
  assert.match(count, /^\*[1-9]\d?$/);
  for (let i = 0; i < Number(count.slice(1)); i++) {
    const size = line(); if (size === null) return null;
    assert.match(size, /^\$\d+$/);
    const length = Number(size.slice(1));
    if (bytes.length < pos + length + 2) return null;
    lines.push(bytes.subarray(pos, pos + length).toString()); pos += length;
    assert.equal(bytes.subarray(pos, pos + 2).toString(), '\r\n'); pos += 2;
  }
  return { parts: lines, length: pos };
}
async function redis(t: TestContext, respond: (parts: string[], socket: Socket) => void) {
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    let pending = Buffer.alloc(0);
    socket.on('data', bytes => {
      pending = Buffer.concat([pending, bytes]);
      while (pending.length) {
        const parsed = parseCommand(pending); if (!parsed) break;
        pending = pending.subarray(parsed.length); respond(parsed.parts, socket);
      }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const address = server.address(); assert.ok(address && typeof address === 'object');
  return address.port;
}

test('RESP client uses only authenticated GET/SET PX, supports fragmented Unicode and null values', async t => {
  const { file } = await secret(t);
  const commands: string[][] = [];
  const values = new Map<string, string>();
  const port = await redis(t, (parts, socket) => {
    commands.push(parts);
    if (parts[0] === 'AUTH') { assert.deepEqual(parts, ['AUTH', 'cache', 'private-test-password']); socket.write('+OK\r\n'); }
    else if (parts[0] === 'SET') { assert.deepEqual(parts.slice(3), ['PX', '100']); values.set(parts[1]!, parts[2]!); socket.write('+OK\r\n'); }
    else {
      assert.equal(parts[0], 'GET');
      const value = values.get(parts[1]!);
      if (value === undefined) socket.write('$-1\r\n');
      else { const bytes = Buffer.from(value); socket.write(`$${bytes.length}\r\n`); socket.write(bytes.subarray(0, 3)); setImmediate(() => socket.write(Buffer.concat([bytes.subarray(3), Buffer.from('\r\n')]))); }
    }
  });
  const store = await createRedisPublicCacheStore({ host: '127.0.0.1', port, username: 'cache', passwordFile: file }, 256);
  t.after(() => store.close());
  assert.equal(await store.get('hd:test:slot:0'), null);
  await store.set('hd:test:slot:0', '中文 русский\nvalue', 100);
  assert.equal(await store.get('hd:test:slot:0'), '中文 русский\nvalue');
  assert.equal(commands.length, 6);
  await assert.rejects(store.set('hd:test:slot:0', 'x'.repeat(257), 100));
  await assert.rejects(store.set('hd:test:slot:0', 'x', 30_001));
  await store.close(); await assert.rejects(store.get('hd:test:slot:0'));
});

test('invalid Redis responses, oversized frames and authentication errors fail without credential text', async t => {
  const { file } = await secret(t);
  for (const reply of ['-ERR private-test-password\r\n', '$257\r\n', '+OK\r\n', '$1\r\nxXX', '*1\r\n$1\r\nx\r\n']) {
    const port = await redis(t, (parts, socket) => socket.write(parts[0] === 'AUTH' ? '+OK\r\n' : reply));
    const store = await createRedisPublicCacheStore({ host: '127.0.0.1', port, username: 'cache', passwordFile: file, timeoutMs: 40 }, 256);
    await assert.rejects(store.get('hd:test:slot:0'), error => error instanceof Error && error.message === 'Public cache storage is unavailable.');
    await store.close();
  }
  const port = await redis(t, (_, socket) => socket.write('-WRONGPASS private-test-password\r\n'));
  const store = await createRedisPublicCacheStore({ host: '127.0.0.1', port, username: 'cache', passwordFile: file }, 256);
  await assert.rejects(store.get('hd:test:slot:0'), { message: 'Public cache storage is unavailable.' });
  await store.close();
});

test('Redis command time and connection count remain bounded even when a server never answers', async t => {
  const { file } = await secret(t);
  const port = await redis(t, () => {});
  const store = await createRedisPublicCacheStore({ host: '127.0.0.1', port, username: 'cache', passwordFile: file, timeoutMs: 30, maxConnections: 1 }, 256);
  const first = store.get('hd:test:slot:0');
  await assert.rejects(store.get('hd:test:slot:1'));
  await assert.rejects(first);
  await store.close();
});

test('credentials require a private regular file and cannot use symlinks, hardlinks or oversized data', async t => {
  const { file, dir } = await secret(t);
  const options = { host: '127.0.0.1', port: 1, username: 'cache', passwordFile: file };
  await chmod(file, 0o644); await assert.rejects(createRedisPublicCacheStore(options, 256));
  await chmod(file, 0o600);
  await symlink(file, path.join(dir, 'linked')); await assert.rejects(createRedisPublicCacheStore({ ...options, passwordFile: path.join(dir, 'linked') }, 256));
  await link(file, path.join(dir, 'hardlinked')); await assert.rejects(createRedisPublicCacheStore(options, 256));
  await rm(path.join(dir, 'hardlinked'));
  await writeFile(file, 'x'.repeat(4097)); await assert.rejects(createRedisPublicCacheStore(options, 256));
  await writeFile(file, 'a\nb'); await assert.rejects(createRedisPublicCacheStore(options, 256));
  await assert.rejects(createRedisPublicCacheStore({ ...options, host: 'example.com' }, 256));
});

test('a FIFO credential path fails promptly instead of blocking API startup', async t => {
  const { dir } = await secret(t);
  const fifo = path.join(dir, 'fifo');
  const execute = promisify(execFile);
  await execute('mkfifo', ['-m', '600', fifo]);
  const source = `import { createRedisPublicCacheStore } from './src/external/redis-cache.ts';
    try { await createRedisPublicCacheStore({host:'127.0.0.1',port:1,username:'cache',passwordFile:process.argv[1]},256); process.exitCode=1; }
    catch(error) { if(error.message!=='Public cache storage is unavailable.') process.exitCode=1; }`;
  // The child timeout makes a future blocking-open regression fail without hanging the test process.
  await execute(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source, fifo], { timeout: 3000 });
});
