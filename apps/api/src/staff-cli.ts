import { pathToFileURL } from 'node:url';
import { readConfig } from './config.js';
import { createDatabase, type Database } from './db/index.js';
import { createAuth, type Auth } from './auth.js';
import { hashPassword } from 'better-auth/crypto';
import { staffLoginEmail } from '@hd/contracts/admin';
import { z } from 'zod';

const passwordSchema = z.string().min(12).max(128);

export async function createStaff(auth: Auth, input: {email:string;name:string;password:string;role:'admin'|'editor'}) {
  const value = z.object({name:z.string().min(1).max(200),password:passwordSchema,role:z.enum(['admin','editor'])}).parse(input);
  return auth.api.createUser({ body: { ...value, email: staffLoginEmail(input.email) } });
}

export async function changeStaffLogin(db: Database, currentLogin: string, newLogin: string, password: string) {
  const currentEmail = staffLoginEmail(currentLogin);
  const newEmail = staffLoginEmail(newLogin);
  const hash = await hashPassword(passwordSchema.parse(password));
  await db.transaction(async tx => {
    const staff = await tx.query(
      'UPDATE staff SET email=$2,email_verified=CASE WHEN email=$2 THEN email_verified ELSE false END,updated_at=now() WHERE email=$1 RETURNING id',
      [currentEmail, newEmail],
    );
    if (staff.rowCount !== 1) throw new Error('Staff account not found');
    const id = staff.rows[0].id;
    const credential = await tx.query(
      "UPDATE staff_accounts SET password=$2,updated_at=now() WHERE user_id=$1 AND provider_id='credential'",
      [id, hash],
    );
    if (credential.rowCount !== 1) throw new Error('Expected exactly one staff credential');
    await tx.query('DELETE FROM staff_sessions WHERE user_id=$1', [id]);
  });
}

export async function setStaffEnabled(db: Database, email: string, enabled: boolean) {
  return db.transaction(async tx => {
    const result = await tx.query('UPDATE staff SET banned=$2,updated_at=now() WHERE email=$1 RETURNING id', [staffLoginEmail(email), !enabled]);
    if (!result.rowCount) throw new Error('Staff account not found');
    await tx.query('DELETE FROM staff_sessions WHERE user_id=$1', [result.rows[0].id]);
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = readConfig(); const db = createDatabase(config.databaseUrl, 2);
  try {
    const [operation, email, name, role = 'editor'] = process.argv.slice(2);
    if (!email) throw new Error('Usage: staff create <login> <name> <admin|editor> | change-login <current-login> <new-login> | disable <login> | enable <login>');
    if (operation === 'create' || operation === 'change-login') {
      // Read a password from stdin so it does not enter shell history or process arguments.
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of process.stdin) { const b = Buffer.from(chunk); size += b.length; if (size > 1024) throw new Error('Password input too long'); chunks.push(b); }
      const password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
      if (operation === 'create') {
        await createStaff(createAuth(db, config), { email, name: name ?? '', role: z.enum(['admin','editor']).parse(role), password });
      } else {
        await changeStaffLogin(db, email, name ?? '', password);
      }
    } else if (operation === 'enable' || operation === 'disable') await setStaffEnabled(db, email, operation === 'enable');
    else throw new Error('Unknown staff operation');
    console.log('Staff account updated.');
  } catch {
    // Database and auth errors can include credential hashes or input values.
    console.error('Staff account could not be updated. Check the login, role, password length and database configuration.');
    process.exitCode = 1;
  } finally { await db.close(); }
}
