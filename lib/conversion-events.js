import db from './db.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS conversion_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    input_format TEXT NOT NULL,
    output_format TEXT NOT NULL,
    mode TEXT NOT NULL CHECK(mode IN ('local', 'server')),
    file_size INTEGER,
    duration REAL,
    saved_to_library INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_conversion_events_user ON conversion_events(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_conversion_events_created ON conversion_events(created_at DESC);
`);

export function logConversionEvent({
  userId = null,
  inputFormat,
  outputFormat,
  mode,
  fileSize = null,
  duration = null,
  savedToLibrary = false,
}) {
  db.prepare(
    `INSERT INTO conversion_events (user_id, input_format, output_format, mode, file_size, duration, saved_to_library)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    inputFormat,
    outputFormat,
    mode,
    fileSize,
    duration,
    savedToLibrary ? 1 : 0
  );
}

export function countConversionEventsForUser(userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM conversion_events WHERE user_id = ?').get(userId).n;
}

export function getFormatStatsForUser(userId) {
  return db
    .prepare(
      `SELECT input_format, output_format, mode, COUNT(*) AS count
       FROM conversion_events WHERE user_id = ?
       GROUP BY input_format, output_format, mode
       ORDER BY count DESC`
    )
    .all(userId);
}

export function getRecentEventsForUser(userId, limit = 25) {
  return db
    .prepare(
      `SELECT input_format, output_format, mode, file_size, duration, saved_to_library, created_at
       FROM conversion_events WHERE user_id = ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(userId, limit)
    .map((row) => ({
      inputFormat: row.input_format,
      outputFormat: row.output_format,
      mode: row.mode,
      fileSize: row.file_size,
      duration: row.duration,
      savedToLibrary: !!row.saved_to_library,
      createdAt: row.created_at,
    }));
}

export function getGlobalFormatStats() {
  return db
    .prepare(
      `SELECT input_format, output_format, COUNT(*) AS count
       FROM conversion_events
       GROUP BY input_format, output_format
       ORDER BY count DESC
       LIMIT 30`
    )
    .all()
    .map((row) => ({
      inputFormat: row.input_format,
      outputFormat: row.output_format,
      count: row.count,
    }));
}

export function getConversionOverview() {
  const total = db.prepare('SELECT COUNT(*) AS n FROM conversion_events').get().n;
  const today = db
    .prepare(`SELECT COUNT(*) AS n FROM conversion_events WHERE date(created_at) = date('now')`)
    .get().n;
  const signedIn = db
    .prepare('SELECT COUNT(*) AS n FROM conversion_events WHERE user_id IS NOT NULL')
    .get().n;
  return { total, today, signedIn, anonymous: total - signedIn };
}

export function deleteConversionEventsForUser(userId) {
  db.prepare('DELETE FROM conversion_events WHERE user_id = ?').run(userId);
}
