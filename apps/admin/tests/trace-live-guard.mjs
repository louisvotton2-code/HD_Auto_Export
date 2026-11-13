export const traceCaseTitle = 'real two-staff creation editing publication and history';
export const traceCase = `(?:^| )${traceCaseTitle}$`;

/** Fail before temp files, DB access or listening; old modes remain under their original guards. */
export function traceMode(env, args, provider) {
  if (!env.ADMIN_LIVE_TRACE) return false;
  if (env.ADMIN_LIVE_TRACE !== 'synthetic-only' || provider !== 'disabled' || env.ADMIN_LIVE_EXTERNAL || env.ADMIN_LIVE_ORIGIN ||
    args.length !== 2 || args[0] !== '--grep' || args[1] !== traceCase) {
    throw new Error('Trace mode requires exactly the owned synthetic two-staff case with translation disabled.');
  }
  let database, web;
  try { database = new URL(env.API_TEST_DATABASE_URL); web = new URL(env.ADMIN_WEB_TARGET); }
  catch { throw new Error('Trace mode requires explicit owned local PostgreSQL and FE preview endpoints.'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || database.hostname !== '127.0.0.1' || database.pathname !== '/postgres' || database.search || database.hash ||
    web.protocol !== 'http:' || web.hostname !== '127.0.0.1' || !web.port || ['3319', '3322', '3363'].includes(web.port) ||
    web.pathname !== '/' || web.search || web.hash || web.username || web.password) {
    throw new Error('Trace mode requires local maintenance /postgres without URL options and a separate owned FE preview; 3363 is forbidden.');
  }
  return true;
}
