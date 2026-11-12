import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getSsrServiceSecret, SsrServiceSecretError } from './ssr-service-secret';

const directories: string[] = [];
function fixture(content: string | Uint8Array, mode = 0o600) {
  const directory = mkdtempSync(join(tmpdir(), 'hd-ssr-secret-'));
  directories.push(directory);
  const file = join(directory, 'service-key');
  writeFileSync(file, content, { mode });
  vi.stubEnv('HD_SSR_SERVICE_SECRET_FILE', file);
  return { directory, file };
}
afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('private SSR service credential', () => {
  it.each(['s'.repeat(32), 'x'.repeat(256), `${'x'.repeat(32)}\n`, `${'x'.repeat(32)}\r\n`])(
    'reads an owner-only credential and removes at most one trailing line ending', (content) => {
      fixture(content);
      expect(getSsrServiceSecret()).toBe(content.replace(/\r?\n$/, ''));
    },
  );

  it('also accepts a read-only private file and reopens the path after atomic rotation', () => {
    const { file, directory } = fixture('a'.repeat(32), 0o400);
    expect(getSsrServiceSecret()).toBe('a'.repeat(32));
    const replacement = join(directory, 'replacement-key');
    writeFileSync(replacement, 'b'.repeat(32), { mode: 0o600 });
    renameSync(replacement, file);
    expect(getSsrServiceSecret()).toBe('b'.repeat(32));
  });

  it('does not provide a default even in tests, or accept a relative/oversize path', () => {
    vi.stubEnv('NODE_ENV', 'test');
    for (const path of [undefined, '', 'relative-key', `/${'x'.repeat(1024)}`]) {
      vi.stubEnv('HD_SSR_SERVICE_SECRET_FILE', path);
      expect(getSsrServiceSecret).toThrow(SsrServiceSecretError);
    }
  });

  it('rejects group/other permission bits and never echoes the configured path or content', () => {
    const key = 'fixture-private-credential-sentinel';
    const { file } = fixture(key);
    for (const mode of [0o640, 0o604, 0o644, 0o601]) {
      chmodSync(file, mode);
      let message = '';
      try { getSsrServiceSecret(); } catch (error) { message = (error as Error).message; }
      expect(message).toContain('HD_SSR_SERVICE_SECRET_FILE');
      expect(message).not.toContain(file);
      expect(message).not.toContain(key);
    }
  });

  it('does not follow a final symlink or read a directory as a credential', () => {
    const { file, directory } = fixture('x'.repeat(32));
    const alias = join(directory, 'alias-key');
    symlinkSync(file, alias);
    vi.stubEnv('HD_SSR_SERVICE_SECRET_FILE', alias);
    expect(getSsrServiceSecret).toThrow(SsrServiceSecretError);
    vi.stubEnv('HD_SSR_SERVICE_SECRET_FILE', directory);
    expect(getSsrServiceSecret).toThrow(SsrServiceSecretError);
  });

  it('rejects files beyond the read cap and malformed/non-ASCII/header-control content', () => {
    const { file } = fixture('x'.repeat(32));
    for (const content of [
      '', 'x'.repeat(31), 'x'.repeat(257), 'x'.repeat(513),
      `${'x'.repeat(32)} `, `${'x'.repeat(32)}\r`, `${'x'.repeat(32)}\n\n`,
      `${'x'.repeat(32)}\r\n\n`, `x\n${'x'.repeat(32)}`, `x\u0000${'x'.repeat(32)}`,
      `é${'x'.repeat(32)}`, Buffer.from([...Buffer.from('x'.repeat(32)), 0xff]),
    ]) {
      writeFileSync(file, content);
      expect(getSsrServiceSecret).toThrow(SsrServiceSecretError);
    }
  });
});
