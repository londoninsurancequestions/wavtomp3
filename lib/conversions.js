import fs from 'fs';
import path from 'path';
import { dataDir } from './data-dir.js';
import { dbGet, dbAll, dbRun, dbInsertReturningId, isPostgres } from './store.js';

export const uploadsRoot = path.join(dataDir, 'uploads');

if (!fs.existsSync(uploadsRoot)) {
  fs.mkdirSync(uploadsRoot, { recursive: true });
}

export function userUploadDir(userId) {
  const dir = path.join(uploadsRoot, String(userId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function createConversion({
  userId,
  originalName,
  outputName,
  mode,
  fileSize,
  duration,
  filePath,
}) {
  const insertSql = isPostgres()
    ? `INSERT INTO conversions (user_id, original_name, output_name, mode, file_size, duration, file_path)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`
    : `INSERT INTO conversions (user_id, original_name, output_name, mode, file_size, duration, file_path)
       VALUES (?, ?, ?, ?, ?, ?, ?)`;
  const id = await dbInsertReturningId(insertSql, [
    userId,
    originalName,
    outputName,
    mode,
    fileSize,
    duration,
    filePath,
  ]);
  return getConversion(userId, id);
}

export async function listConversions(userId) {
  const rows = await dbAll(
    `SELECT id, original_name, output_name, mode, file_size, duration, file_path, created_at
     FROM conversions WHERE user_id = ? ORDER BY created_at DESC`,
    [userId]
  );
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

export async function getConversion(userId, id) {
  const row = await dbGet(
    `SELECT id, original_name, output_name, mode, file_size, duration, file_path, created_at
     FROM conversions WHERE id = ? AND user_id = ?`,
    [id, userId]
  );
  if (!row) return null;
  return { ...toPublicConversion(row), filePath: row.file_path };
}

export async function deleteConversion(userId, id) {
  const row = await dbGet('SELECT file_path FROM conversions WHERE id = ? AND user_id = ?', [
    id,
    userId,
  ]);
  if (!row) return false;

  if (row.file_path && fs.existsSync(row.file_path)) {
    fs.unlinkSync(row.file_path);
  }

  await dbRun('DELETE FROM conversions WHERE id = ? AND user_id = ?', [id, userId]);
  return true;
}
