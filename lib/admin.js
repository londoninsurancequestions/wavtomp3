import fs from 'fs';
import db from './db.js';
import { uploadsRoot } from './conversions.js';
import { deleteConversionEventsForUser } from './conversion-events.js';

function parseAdminEmails() {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email) {
  if (!email) return false;
  const admins = parseAdminEmails();
  if (admins.length === 0) return false;
  return admins.includes(email.trim().toLowerCase());
}

export function requireAdmin(req, res, next) {
  if (!req.userEmail || !isAdminEmail(req.userEmail)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

export function listUsers({ search = '', limit = 50, offset = 0 } = {}) {
  const q = search.trim().toLowerCase();
  const params = [];
  let where = '';

  if (q) {
    where = 'WHERE LOWER(u.email) LIKE ?';
    params.push(`%${q}%`);
  }

  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.stripe_customer_id, u.created_at,
              COUNT(ce.id) AS conversion_count
       FROM users u
       LEFT JOIN conversion_events ce ON ce.user_id = u.id
       ${where}
       GROUP BY u.id
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS n FROM users u ${where}`
    )
    .get(...params);

  return {
    users: rows.map((row) => ({
      id: row.id,
      email: row.email,
      stripeCustomerId: row.stripe_customer_id,
      createdAt: row.created_at,
      conversionCount: row.conversion_count,
    })),
    total: totalRow.n,
  };
}

export function countUsers() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

export function deleteUserAccount(userId) {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return false;

  const conversions = db
    .prepare('SELECT file_path FROM conversions WHERE user_id = ?')
    .all(userId);
  for (const row of conversions) {
    if (row.file_path && fs.existsSync(row.file_path)) {
      fs.unlinkSync(row.file_path);
    }
  }

  const uploadDir = `${uploadsRoot}/${userId}`;
  if (fs.existsSync(uploadDir)) {
    fs.rmSync(uploadDir, { recursive: true, force: true });
  }

  db.prepare('DELETE FROM conversions WHERE user_id = ?').run(userId);
  deleteConversionEventsForUser(userId);
  db.prepare('DELETE FROM used_checkout_sessions WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  return true;
}
