import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {deploymentDatabaseIdentity} from '../database-name.mjs';

const replayPlan = '/private/replay/plan.json';
const admissionPlan = '/private/admission/plan.json';
const admissionReceipt = '/private/admission/receipt.json';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const staffId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const evidenceReference = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const replayCommands = new Set(['replay-check', 'replay-prepare', 'replay-status']);
const admissionCommands = new Set(['admission-check', 'admission-change', 'admission-receipt']);
const deltaCommands = new Set(['delta-prepare', 'delta-arm', 'delta-status', 'delta-reconcile', 'delta-resume-audit']);

function isUtcTimestamp(value) {
  if (value.startsWith('0000-') || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const date = new Date(value);
  const [seconds, fraction = ''] = value.slice(0, -1).split('.');
  return Number.isFinite(date.getTime()) && date.toISOString() === `${seconds}.${fraction.padEnd(3, '0')}Z`;
}

function isEventCursor(value) {
  return /^(0|[1-9][0-9]{0,15})$/.test(value) && Number.isSafeInteger(Number(value));
}

function validDeltaArguments(command, flags) {
  if (command === 'delta-status') return flags.length === 0;
  if (flags[0] !== '--actor' || !staffId.test(flags[1])) return false;
  if (command === 'delta-reconcile') {
    return flags.length === 8 && flags[2] === '--evidence' && evidenceReference.test(flags[3]) &&
      flags[4] === '--since' && isUtcTimestamp(flags[5]) && flags[6] === '--anchor-cursor' && isEventCursor(flags[7]);
  }
  if (flags[2] !== '--snapshot' || !uuid.test(flags[3])) return false;
  if (command !== 'delta-resume-audit') return flags.length === 4;
  return flags.length === 12 && flags[4] === '--snapshot-sha256' && /^[a-f0-9]{64}$/.test(flags[5]) &&
    flags[6] === '--high-water' && isEventCursor(flags[7]) &&
    flags[8] === '--event-audit-cursor' && isEventCursor(flags[9]) &&
    flags[10] === '--evidence' && evidenceReference.test(flags[11]);
}

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
  if (args[0] === 'backup-lease') {
    if (args.length !== 4 || !['acquire', 'release'].includes(args[1]) || args[2] !== '--reference' || !/^backup:[A-Za-z0-9:_-]{1,180}$/.test(args[3])) {
      throw new Error('Backup lease requires an explicit bounded operation and reference');
    }
    // No HTTP server or media ownership scan. Reuse the non-root, disabled-
    // translation worker credential boundary for this one database-only CLI.
    return {argv: ['dist/backup-lease-cli.js', ...args.slice(1)], formalFx: false, fullSync: false};
  }
  if (args[0] === 'full-sync') {
    const [, command, ...flags] = args;
    if (deltaCommands.has(command)) {
      if (!validDeltaArguments(command, flags)) throw new Error('Incremental sync policy requires an exact operation and arguments');
      return {argv: ['dist/external/full-sync/cli.js', ...args.slice(1)], formalFx: false, fullSync: false, replay: true};
    }
    if (admissionCommands.has(command)) {
      const allowed = command === 'admission-change'
        ? flags.length === 4 && flags[0] === '--actor' && staffId.test(flags[1]) &&
          flags[2] === '--plan' && flags[3] === admissionPlan
        : flags.length === 2 && flags[0] === '--plan' &&
          flags[1] === (command === 'admission-receipt' ? admissionReceipt : admissionPlan);
      if (!allowed) throw new Error('Formal admission requires an exact operation and fixed private input');
      return {argv: ['dist/external/full-sync/cli.js', ...args.slice(1)], formalFx: false, fullSync: false, replay: true};
    }
    if (replayCommands.has(command)) {
      const allowed = command === 'replay-check'
        ? flags.length === 2 && flags[0] === '--plan' && flags[1] === replayPlan
        : command === 'replay-status'
          ? flags.length === 2 && flags[0] === '--replay-id' && uuid.test(flags[1])
          : flags.length === 4 && flags[0] === '--actor' && staffId.test(flags[1]) &&
            flags[2] === '--plan' && flags[3] === replayPlan;
      if (!allowed) throw new Error('Replay requires a supported operation and fixed private input');
      return {argv: ['dist/external/full-sync/cli.js', ...args.slice(1)], formalFx: false, fullSync: false, replay: true};
    }
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

export function checkWorkerMode(input, operation) {
  if (input.FULL_SYNC_HEAVY_WORK_PAUSE_PERCENT !== undefined &&
      !['70', '80'].includes(input.FULL_SYNC_HEAVY_WORK_PAUSE_PERCENT)) {
    throw new Error('Unsupported full-sync disk policy');
  }
  if ((input.HD_FULL_REPLAY_OPS !== undefined && input.HD_FULL_REPLAY_OPS !== 'true') ||
      Boolean(operation.replay) !== (input.HD_FULL_REPLAY_OPS === 'true')) {
    throw new Error('Replay requires the dedicated one-shot service');
  }
  if (operation.replay && (input.CHINACARAPI_KEY_FILE || input.CHINACARAPI_ACCOUNT_KEY_FILE ||
      input.FULL_SYNC_ARCHIVE_ROOT || input.FULL_SYNC_CAPACITY_DECISION_FILE)) {
    throw new Error('Replay operation must not inherit worker mounts or credentials');
  }
  if (operation.fullSync && input.FULL_SYNC_ARCHIVE_ROOT !== '/private/full-sync') {
    throw new Error('Full sync requires the dedicated persistent archive mount');
  }
}

export async function main(args = process.argv.slice(2)) {
  const operation = workerInvocation(args);
  checkWorkerMode(process.env, operation);
  const {readLocalSecret} = await import('/app/apps/api/dist/local-secrets.js');
  const env = workerEnvironment(process.env, readLocalSecret('/run/secrets/app_db_password'));
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
