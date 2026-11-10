import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';

/** Mounted secrets are regular, owner-only files. Error messages never contain the path or value. */
export function readLocalSecret(file: string, limit = 8192): string {
  let fd: number | undefined;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit || (stat.mode & 0o077) !== 0) throw new Error();
    const bytes = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (count === 0) break;
      size += count;
    }
    if (size > limit) throw new Error();
    const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)).replace(/\r?\n$/, '');
    if (!value || /[\u0000\r\n]/.test(value)) throw new Error();
    return value;
  } catch { throw new Error('Cannot read the configured private secret file'); }
  finally { if (fd !== undefined) closeSync(fd); }
}

export function readDatabaseEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (env.DATABASE_URL_FILE === undefined) return env;
  if (env.DATABASE_URL !== undefined) throw new Error('Set exactly one database URL source');
  const { DATABASE_URL_FILE, ...rest } = env;
  return { ...rest, DATABASE_URL: readLocalSecret(DATABASE_URL_FILE!) };
}
