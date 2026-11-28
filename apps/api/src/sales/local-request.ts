import path from 'node:path';
import { readLocalSecret } from '../local-secrets.js';
import { salesVehiclesPath, salesVehicleLookupPath } from './access.js';

const feed = ['locale', 'make', 'model', 'trim', 'yearMin', 'yearMax', 'mileageMin', 'mileageMax', 'powertrain',
  'drivetrain', 'priceMin', 'priceMax', 'priceCurrency', 'limit', 'cursor'];
const lookup = ['locale', 'stockCode', 'detailUrl', 'configurationLimit', 'configurationCursor'];

async function main() {
  const [operation, ...filters] = process.argv.slice(2);
  if (operation !== 'feed' && operation !== 'lookup') throw new Error('Choose feed or lookup.');
  const tokenFile = process.env.SALES_API_TOKEN_FILE;
  if (!tokenFile || !path.isAbsolute(tokenFile)) throw new Error('An absolute local token file is required.');
  const token = readLocalSecret(tokenFile, 128);
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error('Invalid local token file.');
  const route = operation === 'feed' ? salesVehiclesPath : salesVehicleLookupPath;
  const url = new URL(route, 'http://127.0.0.1:3363');
  const allowed = operation === 'feed' ? feed : lookup;
  for (const input of filters) {
    const position = input.indexOf('=');
    const key = input.slice(0, position);
    if (position < 1 || !allowed.includes(key) || url.searchParams.has(key)) throw new Error('Invalid filter argument.');
    url.searchParams.set(key, input.slice(position + 1));
  }
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(5_000),
  });
  const body = await response.json();
  process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
  if (!response.ok) process.exitCode = 1;
}

void main().catch(() => {
  process.stderr.write('Sales API request could not be completed. Check the local gateway, token file and filter arguments.\n');
  process.exitCode = 1;
});
