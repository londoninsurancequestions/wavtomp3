import 'dotenv/config';
import { initStore } from '../lib/store.js';
import { findUserByEmail, createUser, updateUserPassword } from '../lib/db.js';
import { hashPassword } from '../lib/auth.js';

const email = (process.env.SEED_EMAIL || 'mike@zamzar.com').trim().toLowerCase();
const password = process.env.SEED_PASSWORD;

if (!password) {
  console.error('Usage: SEED_PASSWORD=yourpassword node scripts/seed-admin-user.js');
  process.exit(1);
}

await initStore();

const existing = await findUserByEmail(email);
const passwordHash = await hashPassword(password);

if (existing) {
  await updateUserPassword(existing.id, passwordHash);
  console.log(`Updated password for existing user #${existing.id} (${email})`);
} else {
  const user = await createUser(email, passwordHash, null);
  console.log(`Created user #${user.id} (${email})`);
}

const admins = (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase());
if (!admins.includes(email)) {
  console.warn(`Warning: ${email} is not in ADMIN_EMAILS — add it to grant admin console access.`);
} else {
  console.log(`${email} is listed in ADMIN_EMAILS.`);
}
