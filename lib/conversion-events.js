import { dbGet, dbAll, dbRun, isPostgres } from './store.js';

export async function logConversionEvent({
  userId = null,
  inputFormat,
  outputFormat,
  mode,
  fileSize = null,
  duration = null,
  savedToLibrary = false,
}) {
  await dbRun(
    `INSERT INTO conversion_events (user_id, input_format, output_format, mode, file_size, duration, saved_to_library)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      inputFormat,
      outputFormat,
      mode,
      fileSize,
      duration,
      isPostgres() ? savedToLibrary : savedToLibrary ? 1 : 0,
    ]
  );
}

export async function countConversionEventsForUser(userId) {
  const row = await dbGet('SELECT COUNT(*) AS n FROM conversion_events WHERE user_id = ?', [userId]);
  return Number(row?.n ?? 0);
}

export async function getFormatStatsForUser(userId) {
  return dbAll(
    `SELECT input_format, output_format, mode, COUNT(*) AS count
     FROM conversion_events WHERE user_id = ?
     GROUP BY input_format, output_format, mode
     ORDER BY count DESC`,
    [userId]
  );
}

export async function getRecentEventsForUser(userId, limit = 25) {
  const rows = await dbAll(
    `SELECT input_format, output_format, mode, file_size, duration, saved_to_library, created_at
     FROM conversion_events WHERE user_id = ?
     ORDER BY created_at DESC LIMIT ?`,
    [userId, limit]
  );
  return rows.map((row) => ({
    inputFormat: row.input_format,
    outputFormat: row.output_format,
    mode: row.mode,
    fileSize: row.file_size,
    duration: row.duration,
    savedToLibrary: !!row.saved_to_library,
    createdAt: row.created_at,
  }));
}

export async function getGlobalFormatStats() {
  const rows = await dbAll(
    `SELECT input_format, output_format, COUNT(*) AS count
     FROM conversion_events
     GROUP BY input_format, output_format
     ORDER BY count DESC
     LIMIT 30`,
    []
  );
  return rows.map((row) => ({
    inputFormat: row.input_format,
    outputFormat: row.output_format,
    count: Number(row.count),
  }));
}

export async function getConversionOverview() {
  const totalRow = await dbGet('SELECT COUNT(*) AS n FROM conversion_events', []);
  const todaySql = isPostgres()
    ? `SELECT COUNT(*) AS n FROM conversion_events WHERE created_at::date = CURRENT_DATE`
    : `SELECT COUNT(*) AS n FROM conversion_events WHERE date(created_at) = date('now')`;
  const todayRow = await dbGet(todaySql, []);
  const signedInRow = await dbGet(
    'SELECT COUNT(*) AS n FROM conversion_events WHERE user_id IS NOT NULL',
    []
  );
  const total = Number(totalRow?.n ?? 0);
  const signedIn = Number(signedInRow?.n ?? 0);
  return {
    total,
    today: Number(todayRow?.n ?? 0),
    signedIn,
    anonymous: total - signedIn,
  };
}

export async function deleteConversionEventsForUser(userId) {
  await dbRun('DELETE FROM conversion_events WHERE user_id = ?', [userId]);
}
