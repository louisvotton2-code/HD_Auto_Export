import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertServerRuntimeConfiguration,
  getServerReleaseIdentity,
  parseServerReleaseIdentity,
  ServerRuntimeConfigurationError,
  serverRuntimeStartupError,
} from './server-runtime';
import { register } from '../../instrumentation';

const commit = 'b236d1e74ef6b20d25f471b0de875daaef453e02';
const digest = 'a'.repeat(64);
const privateDirectories: string[] = [];

function configureFixtureSecret() {
  const directory = mkdtempSync(join(tmpdir(), 'hd-runtime-config-'));
  privateDirectories.push(directory);
  const file = join(directory, 'service-key');
  writeFileSync(file, 'fixture-service-key-0123456789abcdef', { mode: 0o600 });
  vi.stubEnv('HD_SSR_SERVICE_SECRET_FILE', file);
  return file;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const directory of privateDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('explicit server release identity', () => {
  it.each([commit, 'a'.repeat(48), digest, `sha256:${digest}`])(
    'accepts immutable production identity %s', (releaseId) => {
      const result = parseServerReleaseIdentity({ HD_DEPLOYMENT_ENV: 'production', HD_RELEASE_ID: releaseId });
      expect(result).toEqual({ deploymentEnv: 'production', releaseId });
      expect(Object.isFrozen(result)).toBe(true);
    },
  );

  it.each(['local', 'test'] as const)('requires an explicit fixed label for %s', (deploymentEnv) => {
    const env = { HD_DEPLOYMENT_ENV: deploymentEnv, HD_RELEASE_ID: 'fe-rel03-fixture' };
    expect(parseServerReleaseIdentity(env)).toEqual({ deploymentEnv, releaseId: 'fe-rel03-fixture' });
    expect(env).toEqual({ HD_DEPLOYMENT_ENV: deploymentEnv, HD_RELEASE_ID: 'fe-rel03-fixture' });
    expect(() => parseServerReleaseIdentity({ HD_DEPLOYMENT_ENV: deploymentEnv })).toThrow('HD_RELEASE_ID');
    expect(() => parseServerReleaseIdentity({ ...env, HD_RELEASE_ID: 'unreleased' })).toThrow('HD_RELEASE_ID');
  });

  it('does not infer deployment identity from NODE_ENV, public variables or request-shaped values', () => {
    expect(() => parseServerReleaseIdentity({ NODE_ENV: 'production', NEXT_PUBLIC_HD_RELEASE_ID: commit, HOST: 'cars.example', COOKIE: 'fixture' }))
      .toThrow('HD_DEPLOYMENT_ENV');
    expect(() => parseServerReleaseIdentity({ HD_DEPLOYMENT_ENV: 'production', NEXT_PUBLIC_HD_RELEASE_ID: commit }))
      .toThrow('HD_RELEASE_ID');
  });

  it('rejects mutable production labels and never echoes their actual values', () => {
    for (const releaseId of ['latest', 'b236d1e', 'web:release-001', 'fixture-private-sentinel', commit.toUpperCase(), `registry.example/hd/web@sha256:${digest}`]) {
      const run = () => parseServerReleaseIdentity({ HD_DEPLOYMENT_ENV: 'production', HD_RELEASE_ID: releaseId });
      expect(run).toThrow(ServerRuntimeConfigurationError);
      try { run(); } catch (error) {
        expect((error as Error).message).toContain('HD_RELEASE_ID');
        expect((error as Error).message).not.toContain(releaseId);
      }
    }
  });

  it('rejects malformed namespaces without silently trimming or rewriting them', () => {
    for (const deploymentEnv of ['', 'PRODUCTION', 'staging', ' local']) {
      expect(() => parseServerReleaseIdentity({ HD_DEPLOYMENT_ENV: deploymentEnv, HD_RELEASE_ID: commit })).toThrow('HD_DEPLOYMENT_ENV');
    }
    for (const releaseId of ['', ` ${commit}`, `${commit}\n`, 'release\u0000one', 'a'.repeat(257)]) {
      expect(() => parseServerReleaseIdentity({ HD_DEPLOYMENT_ENV: 'test', HD_RELEASE_ID: releaseId })).toThrow('HD_RELEASE_ID');
    }
    expect(parseServerReleaseIdentity({ HD_DEPLOYMENT_ENV: 'test', HD_RELEASE_ID: 'a'.repeat(256) }).releaseId).toHaveLength(256);
  });

  it('reads process configuration explicitly without holding a stale namespace after a deliberate change', () => {
    vi.stubEnv('HD_DEPLOYMENT_ENV', 'test');
    vi.stubEnv('HD_RELEASE_ID', 'release-one');
    configureFixtureSecret();
    expect(getServerReleaseIdentity()).toEqual({ deploymentEnv: 'test', releaseId: 'release-one' });
    expect(assertServerRuntimeConfiguration()).toBeUndefined();
    vi.stubEnv('HD_RELEASE_ID', 'release-two');
    expect(getServerReleaseIdentity()).toEqual({ deploymentEnv: 'test', releaseId: 'release-two' });
  });
});

describe('Node instrumentation startup gate', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-process-exit'); });
  });

  it('exits a Node server with missing deployment identity before attempting the service key', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('HD_DEPLOYMENT_ENV', undefined);
    vi.stubEnv('HD_RELEASE_ID', undefined);
    vi.stubEnv('HD_SSR_SERVICE_SECRET_FILE', '/private/fixture-missing-key');
    const error = vi.mocked(console.error);
    const exit = vi.mocked(process.exit);
    expect(assertServerRuntimeConfiguration).toThrow('HD_DEPLOYMENT_ENV');
    await expect(register()).rejects.toThrow('fixture-process-exit');
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('HD_DEPLOYMENT_ENV'));
    expect(JSON.stringify(error.mock.calls)).not.toContain('/private/fixture-missing-key');
  });

  it('allows a configured production Node server with an explicit private key file', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('HD_DEPLOYMENT_ENV', 'production');
    vi.stubEnv('HD_RELEASE_ID', commit);
    configureFixtureSecret();
    await expect(register()).resolves.toBeUndefined();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('allows a configured test Node server with an explicit private key file', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('HD_DEPLOYMENT_ENV', 'test');
    vi.stubEnv('HD_RELEASE_ID', 'fe-rel03-fixture');
    configureFixtureSecret();
    await expect(register()).resolves.toBeUndefined();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('exits for a missing private key without printing its path or falling back to a fixture key', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('HD_DEPLOYMENT_ENV', 'production');
    vi.stubEnv('HD_RELEASE_ID', commit);
    const missingFile = '/private/fixture-service-key-path-sentinel';
    vi.stubEnv('HD_SSR_SERVICE_SECRET_FILE', missingFile);
    const error = vi.mocked(console.error);
    const exit = vi.mocked(process.exit);
    await expect(register()).rejects.toThrow('fixture-process-exit');
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('HD_SSR_SERVICE_SECRET_FILE'));
    expect(JSON.stringify(error.mock.calls)).not.toContain(missingFile);
  });

  it('does not load the Node gate in Edge, and sanitizes unknown startup errors', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    vi.stubEnv('HD_DEPLOYMENT_ENV', undefined);
    vi.stubEnv('HD_RELEASE_ID', undefined);
    vi.stubEnv('HD_SSR_SERVICE_SECRET_FILE', undefined);
    await expect(register()).resolves.toBeUndefined();
    expect(process.exit).not.toHaveBeenCalled();
    expect(serverRuntimeStartupError(new Error('/private/fixture-path and fixture-secret')))
      .toBe('[HD Auto server configuration] Runtime configuration validation failed.');
  });
});
