import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';

// Same owner-controlled, atomically replaced marker consumed by Web and the gateway.
export function readBrowseFence(file: string): string | null {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = fstatSync(descriptor);
    if (!info.isFile() || (info.mode & 0o022) !== 0 || info.size !== 33) return null;
    const bytes = Buffer.alloc(34);
    if (readSync(descriptor, bytes, 0, bytes.length, null) !== 33) return null;
    return /^([0-9a-f]{32})\n$/.exec(bytes.subarray(0, 33).toString('latin1'))?.[1] ?? null;
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
