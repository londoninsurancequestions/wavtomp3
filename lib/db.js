import { dbGet, dbRun, dbInsertReturningId, isPostgres } from './store.js';

function emailMatchSql(column = 'email') {
  return isPostgres() ? `LOWER(${column}) = LOWER(?)` : `${column} = ? COLLATE NOCASE`;
}

export async function findUserByEmail(email) {
  return dbGet(`SELECT * FROM users WHERE ${emailMatchSql()}`, [email]);
}

export async function findUserById(id) {
  return dbGet('SELECT id, email, stripe_customer_id, created_at FROM users WHERE id = ?', [id]);
}

export async function findUserAuthById(id) {
  return dbGet('SELECT id, email, password_hash FROM users WHERE id = ?', [id]);
}

export async function updateUserPassword(userId, passwordHash) {
  await dbRun('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);
}

export async function updateUserStripeCustomerId(userId, stripeCustomerId) {
  await dbRun('UPDATE users SET stripe_customer_id = ? WHERE id = ?', [stripeCustomerId, userId]);
}

export async function findUserByStripeCustomerId(customerId) {
  return dbGet(
    'SELECT id, email, stripe_customer_id, created_at FROM users WHERE stripe_customer_id = ?',
    [customerId]
  );
}

export async function createUser(email, passwordHash, stripeCustomerId) {
  const sql = isPostgres()
    ? 'INSERT INTO users (email, password_hash, stripe_customer_id) VALUES (?, ?, ?) RETURNING id'
    : 'INSERT INTO users (email, password_hash, stripe_customer_id) VALUES (?, ?, ?)';
  const id = await dbInsertReturningId(sql, [email, passwordHash, stripeCustomerId]);
  return findUserById(id);
}

export async function markCheckoutSessionUsed(sessionId, userId) {
  await dbRun('INSERT INTO used_checkout_sessions (session_id, user_id) VALUES (?, ?)', [
    sessionId,
    userId,
  ]);
}

export async function isCheckoutSessionUsed(sessionId) {
  const row = await dbGet('SELECT 1 AS ok FROM used_checkout_sessions WHERE session_id = ?', [
    sessionId,
  ]);
  return !!row;
}

export async function countUsers() {
  const row = await dbGet('SELECT COUNT(*) AS n FROM users', []);
  return Number(row?.n ?? 0);
}
