import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = portIndex >= 0 ? args[portIndex + 1] : process.env.PORT || '3317';
if (!port || !/^\d+$/.test(port) || +port < 1 || +port > 65535) throw new Error('Invalid port');
const root = fileURLToPath(new URL('../.next/standalone/apps/web/', import.meta.url));
const child = spawn(process.execPath, [`${root}server.js`], {
  stdio: 'inherit',
  env: { ...process.env, HOSTNAME: '127.0.0.1', PORT: port },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));
