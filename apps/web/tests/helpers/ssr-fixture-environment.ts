import { randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fileVariable = 'HD_E2E_SSR_FIXTURE_SECRET_FILE';
const ownerVariable = 'HD_E2E_SSR_FIXTURE_OWNER_PID';
const stateKey = Symbol.for('hd-auto.playwright.ssr-fixture');
type FixtureState = { directory: string; file: string; owner: number; removeHooks: () => void };
const runtime = globalThis as typeof globalThis & { [key: symbol]: FixtureState | undefined };

/** Only the config process that created the disposable file may remove it. */
export function cleanupSsrFixtureEnvironment() {
  const state = runtime[stateKey];
  if (!state || state.owner !== process.pid) return;
  rmSync(state.directory, { recursive: true, force: true });
  state.removeHooks();
  delete runtime[stateKey];
  if (process.env[fileVariable] === state.file) delete process.env[fileVariable];
  if (process.env[ownerVariable] === String(state.owner)) delete process.env[ownerVariable];
}

/** Worker config reloads inherit the path, never the credential value or its ownership. */
export function ssrFixtureEnvironment(): Record<string, string> | undefined {
  if (process.env.E2E_BASE_URL) return undefined;
  let file = runtime[stateKey]?.file;
  if (!file && process.env[fileVariable] && process.env[ownerVariable]) {
    file = process.env[fileVariable];
  }
  if (!file) {
    const directory = mkdtempSync(join(tmpdir(), 'hd-ssr-e2e-'));
    file = join(directory, 'service-secret');
    try {
      chmodSync(directory, 0o700);
      writeFileSync(file, `${randomBytes(48).toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
      chmodSync(file, 0o600);
    } catch {
      rmSync(directory, { recursive: true, force: true });
      throw new Error('Unable to prepare the disposable SSR fixture credential.');
    }
    const signalHandlers = (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map((signal) => [
      signal,
      () => {
        cleanupSsrFixtureEnvironment();
        // Preserve Playwright's graceful shutdown, or the normal signal exit when it has no handler.
        if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
      },
    ] as const);
    runtime[stateKey] = {
      directory, file, owner: process.pid,
      removeHooks: () => {
        process.off('exit', cleanupSsrFixtureEnvironment);
        for (const [signal, handler] of signalHandlers) process.off(signal, handler);
      },
    };
    process.env[fileVariable] = file;
    process.env[ownerVariable] = String(process.pid);
    // Covers config errors and webServer startup failures before global teardown can run.
    process.once('exit', cleanupSsrFixtureEnvironment);
    for (const [signal, handler] of signalHandlers) process.once(signal, handler);
  }
  return {
    HD_SSR_SERVICE_SECRET_FILE: file,
    HD_DEPLOYMENT_ENV: 'test',
    HD_RELEASE_ID: 'fe03000000000000000000000000000000000000',
  };
}
