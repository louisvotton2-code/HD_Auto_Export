import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export class SsrServiceSecretError extends Error {
  constructor() {
    super('[HD Auto server configuration] Cannot read HD_SSR_SERVICE_SECRET_FILE as a regular owner-only private service credential.');
    this.name = 'SsrServiceSecretError';
  }
}

/** Read a mounted service credential without following links or blocking on special files. */
export function readPrivateServiceSecret(file: string | undefined): string | undefined {
  if (!file || file.length > 1024 || !isAbsolute(file)) return undefined;
  let fd: number | undefined;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 512) return undefined;

    // Limit reads too: the file may grow after fstat without exceeding this allocation.
    const bytes = Buffer.alloc(513);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (count === 0) break;
      size += count;
    }
    if (size > 512) return undefined;
    let end = size;
    if (end > 0 && bytes[end - 1] === 0x0a) {
      end -= 1;
      if (end > 0 && bytes[end - 1] === 0x0d) end -= 1;
    }
    if (end < 32 || end > 256) return undefined;
    for (let index = 0; index < end; index += 1) {
      if (bytes[index]! < 0x21 || bytes[index]! > 0x7e) return undefined;
    }
    return bytes.subarray(0, end).toString('ascii');
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Read the SSR credential afresh, without exposing its path or value. */
export function getSsrServiceSecret(): string {
  const value = readPrivateServiceSecret(process.env.HD_SSR_SERVICE_SECRET_FILE);
  if (!value) throw new SsrServiceSecretError();
  return value;
}
