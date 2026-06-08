import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'wavtomp3.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    stripe_customer_id TEXT UNIQUE,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS used_checkout_sessions (
    session_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

export function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email);
}

export function findUserById(id) {
  return db.prepare('SELECT id, email, stripe_customer_id, created_at FROM users WHERE id = ?').get(id);
}

export function findUserAuthById(id) {
  return db.prepare('SELECT id, email, password_hash FROM users WHERE id = ?').get(id);
}

export function updateUserPassword(userId, passwordHash) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
}

export function findUserByStripeCustomerId(customerId) {
  return db
    .prepare('SELECT id, email, stripe_customer_id, created_at FROM users WHERE stripe_customer_id = ?')
    .get(customerId);
}

export function createUser(email, passwordHash, stripeCustomerId) {
  const result = db
    .prepare('INSERT INTO users (email, password_hash, stripe_customer_id) VALUES (?, ?, ?)')
    .run(email, passwordHash, stripeCustomerId);
  return findUserById(result.lastInsertRowid);
}

export function markCheckoutSessionUsed(sessionId, userId) {
  db.prepare('INSERT INTO used_checkout_sessions (session_id, user_id) VALUES (?, ?)').run(
    sessionId,
    userId
  );
}

export function isCheckoutSessionUsed(sessionId) {
  return !!db.prepare('SELECT 1 FROM used_checkout_sessions WHERE session_id = ?').get(sessionId);
}

export default db;
