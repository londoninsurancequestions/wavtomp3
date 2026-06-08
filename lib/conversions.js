import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const uploadsRoot = path.join(__dirname, '..', 'data', 'uploads');

if (!fs.existsSync(uploadsRoot)) {
  fs.mkdirSync(uploadsRoot, { recursive: true });
}

db.exec(`
  CREATE TABLE IF NOT EXISTS conversions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    original_name TEXT NOT NULL,
    output_name TEXT NOT NULL,
    mode TEXT NOT NULL CHECK(mode IN ('local', 'server')),
    file_size INTEGER,
    duration REAL,
    file_path TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_conversions_user ON conversions(user_id, created_at DESC);
`);

export function userUploadDir(userId) {
  const dir = path.join(uploadsRoot, String(userId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function createConversion({
  userId,
  originalName,
  outputName,
  mode,
  fileSize,
  duration,
  filePath,
}) {
  const result = db
    .prepare(
      `INSERT INTO conversions (user_id, original_name, output_name, mode, file_size, duration, file_path)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(userId, originalName, outputName, mode, fileSize, duration, filePath);

  return getConversion(userId, result.lastInsertRowid);
}

export function listConversions(userId) {
  const rows = db
    .prepare(
      `SELECT id, original_name, output_name, mode, file_size, duration, file_path, created_at
       FROM conversions WHERE user_id = ? ORDER BY created_at DESC`
    )
    .all(userId);

  return rows.map((row) => toPublicConversion(row));
}

function fileExists(filePath) {
  return !!(filePath && fs.existsSync(filePath));
}

function toPublicConversion(row) {
  const available = fileExists(row.file_path);
  return {
    id: row.id,
    originalName: row.original_name,
    outputName: row.output_name,
    mode: row.mode,
    fileSize: row.file_size,
    duration: row.duration,
    createdAt: row.created_at,
    available,
  };
}

export function getConversion(userId, id) {
  const row = db
    .prepare(
      `SELECT id, original_name, output_name, mode, file_size, duration, file_path, created_at
       FROM conversions WHERE id = ? AND user_id = ?`
    )
    .get(id, userId);

  if (!row) return null;
  return { ...toPublicConversion(row), filePath: row.file_path };
}

export function deleteConversion(userId, id) {
  const row = db
    .prepare('SELECT file_path FROM conversions WHERE id = ? AND user_id = ?')
    .get(id, userId);

  if (!row) return false;

  if (row.file_path && fs.existsSync(row.file_path)) {
    fs.unlinkSync(row.file_path);
  }

  db.prepare('DELETE FROM conversions WHERE id = ? AND user_id = ?').run(id, userId);
  return true;
}
