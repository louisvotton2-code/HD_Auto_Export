import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {deploymentDatabaseIdentity} from '../database-name.mjs';

export function workerEnvironment(input, password, uid = process.getuid?.()) {
  if (!Number.isInteger(uid) || uid <= 0) throw new Error('Worker must start as a non-root user');
  if (input.DATABASE_URL || input.DATABASE_URL_FILE) throw new Error('Worker database override rejected');
  if (input.HD_DEPLOYMENT_ENV !== 'production' || !/^[a-f0-9]{40}$/.test(input.HD_RELEASE_ID ?? '')) {
    throw new Error('Worker requires an explicit production release');
  }
  if (input.EXTERNAL_SYNC_MODE !== 'off' || input.TRANSLATION_PROVIDER !== 'disabled') {
    throw new Error('Legacy synthetic sync and translation must be disabled');
  }
  if (!password || /[\u0000\r\n]/.test(password)) throw new Error('Invalid database secret');
  const {database, user} = deploymentDatabaseIdentity(input.HD_DATABASE_NAME);
  if (database === 'hd_auto') throw new Error('Worker requires the current validated release database');
  const {EXTERNAL_FX_NETWORK, EXTERNAL_FX_FORMAL_DATABASE, ...rest} = input;
  return {...rest, DATABASE_URL: `postgresql://${user}:${encodeURIComponent(password)}@postgres:5432/${database}`};
}

export function workerInvocation(args) {
  if (args[0] === 'full-sync') {
    if (!['configure', 'run', 'serve', 'status', 'control', 'archive-pin', 'archive-release'].includes(args[1])) {
      throw new Error('Full sync requires an explicit supported operation');
    }
    return {argv: ['dist/external/full-sync/cli.js', ...args.slice(1)], formalFx: false, fullSync: true};
  }
  if (['fx-refresh', 'fx-health'].includes(args[0])) {
    if (args.length !== 1) throw new Error('Formal FX operation accepts no extra arguments');
    return {argv: ['dist/external/fx-cli.js', args[0] === 'fx-refresh' ? '--formal-refresh' : '--formal-health'], formalFx: true};
  }
  if (!['prepare', 'catch-up', 'once', 'status', 'recover'].includes(args[0])) throw new Error('Worker requires an explicit bounded operation');
  return {argv: ['dist/external/ingestion/cli.js', ...args], formalFx: false};
}

export async function main(args = process.argv.slice(2)) {
  const operation = workerInvocation(args);
  const {readLocalSecret} = await import('/app/apps/api/dist/local-secrets.js');
  const env = workerEnvironment(process.env, readLocalSecret('/run/secrets/app_db_password'));
  if (operation.fullSync && env.FULL_SYNC_ARCHIVE_ROOT !== '/private/full-sync') {
    throw new Error('Full sync requires the dedicated persistent archive mount');
  }
  if (operation.formalFx) {
    env.EXTERNAL_CATALOG_MODE = 'disabled';
    env.EXTERNAL_FX_NETWORK = 'enabled';
    env.EXTERNAL_FX_FORMAL_DATABASE = env.HD_DATABASE_NAME;
  }
  const child = spawn(process.execPath, operation.argv, {stdio: 'inherit', env});
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
  child.on('error', () => {console.error('Worker could not start'); process.exit(1);});
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {console.error('Worker startup refused'); process.exitCode = 1;});
}
