import { pathToFileURL } from 'node:url';
import { readConfig } from './config.js';
import { createDatabase, type Database } from './db/index.js';
import { createAuth, type Auth } from './auth.js';
import { z } from 'zod';

export async function createStaff(auth: Auth, input: {email:string;name:string;password:string;role:'admin'|'editor'}) {
  const value = z.object({email:z.email(),name:z.string().min(1).max(200),password:z.string().min(12).max(128),role:z.enum(['admin','editor'])}).parse(input);
  return auth.api.createUser({ body: value });
}
export async function setStaffEnabled(db: Database, email: string, enabled: boolean) {
  return db.transaction(async tx => {
    const result = await tx.query('UPDATE staff SET banned=$2,updated_at=now() WHERE email=$1 RETURNING id', [email.toLowerCase(), !enabled]);
    if (!result.rowCount) throw new Error('Staff account not found');
    await tx.query('DELETE FROM staff_sessions WHERE user_id=$1', [result.rows[0].id]);
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = readConfig(); const db = createDatabase(config.databaseUrl, 2);
  try {
    const [operation, email, name, role = 'editor'] = process.argv.slice(2);
    if (!email) throw new Error('Usage: staff create <email> <name> <admin|editor> | disable <email> | enable <email>');
    if (operation === 'create') {
      // Read a password from stdin so it does not enter shell history or process arguments.
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of process.stdin) { const b = Buffer.from(chunk); size += b.length; if (size > 1024) throw new Error('Password input too long'); chunks.push(b); }
      const password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
      await createStaff(createAuth(db, config), { email, name: name ?? '', role: z.enum(['admin','editor']).parse(role), password });
    } else if (operation === 'enable' || operation === 'disable') await setStaffEnabled(db, email, operation === 'enable');
    else throw new Error('Unknown staff operation');
    console.log('Staff account updated.');
  } finally { await db.close(); }
}
