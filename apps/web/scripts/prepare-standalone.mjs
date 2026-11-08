import { cp, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const app = fileURLToPath(new URL('../', import.meta.url));
const standaloneApp = `${app}.next/standalone/apps/web`;
await access(`${standaloneApp}/server.js`);
await mkdir(`${standaloneApp}/.next`, { recursive: true });
await cp(`${app}public`, `${standaloneApp}/public`, { recursive: true });
await cp(`${app}.next/static`, `${standaloneApp}/.next/static`, { recursive: true });
console.log(
  'Standalone prepared: .next/standalone/apps/web/server.js (includes public and static assets).',
);
