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
    throw new Error('Continuous sync and translation must be disabled');
  }
  if (!password || /[\u0000\r\n]/.test(password)) throw new Error('Invalid database secret');
  const {database, user} = deploymentDatabaseIdentity(input.HD_DATABASE_NAME);
  if (database === 'hd_auto') throw new Error('Worker requires the current validated release database');
  return {...input, DATABASE_URL: `postgresql://${user}:${encodeURIComponent(password)}@postgres:5432/${database}`};
}

export async function main(args = process.argv.slice(2)) {
  if (!['prepare', 'catch-up', 'once', 'status', 'recover'].includes(args[0])) {
    throw new Error('Worker requires an explicit bounded operation');
  }
  const {readLocalSecret} = await import('/app/apps/api/dist/local-secrets.js');
  const env = workerEnvironment(process.env, readLocalSecret('/run/secrets/app_db_password'));
  const child = spawn(process.execPath, ['dist/external/ingestion/cli.js', ...args], {stdio: 'inherit', env});
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
  child.on('error', () => {console.error('Worker could not start'); process.exit(1);});
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {console.error('Worker startup refused'); process.exitCode = 1;});
}
