import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { dataDir } from './data-dir.js';

const { Pool } = pg;

let driver = null;
let pool = null;
let sqlite = null;
let sqlitePath = null;

function toPgSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function pgSsl() {
  const url = process.env.DATABASE_URL || '';
  if (process.env.PGSSLMODE === 'disable') return false;
  if (url.includes('localhost') || url.includes('127.0.0.1')) return false;
  return { rejectUnauthorized: false };
}

const SQLITE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    stripe_customer_id TEXT UNIQUE,
    unlocked_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS used_checkout_sessions (
    session_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

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

  CREATE TABLE IF NOT EXISTS free_tier_usage (
    identity_key TEXT NOT NULL,
    usage_day TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (identity_key, usage_day)
  );

  CREATE TABLE IF NOT EXISTS funnel_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_key TEXT NOT NULL,
    event_type TEXT NOT NULL,
    meta TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_funnel_events_type ON funnel_events(event_type, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_funnel_events_visitor ON funnel_events(visitor_key, event_type);
`;

const PG_SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    stripe_customer_id TEXT UNIQUE,
    unlocked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS used_checkout_sessions (
    session_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS conversions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    original_name TEXT NOT NULL,
    output_name TEXT NOT NULL,
    mode TEXT NOT NULL CHECK(mode IN ('local', 'server')),
    file_size INTEGER,
    duration DOUBLE PRECISION,
    file_path TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_conversions_user ON conversions(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS conversion_events (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    input_format TEXT NOT NULL,
    output_format TEXT NOT NULL,
    mode TEXT NOT NULL CHECK(mode IN ('local', 'server')),
    file_size INTEGER,
    duration DOUBLE PRECISION,
    saved_to_library BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_conversion_events_user ON conversion_events(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_conversion_events_created ON conversion_events(created_at DESC);

  CREATE TABLE IF NOT EXISTS free_tier_usage (
    identity_key TEXT NOT NULL,
    usage_day TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (identity_key, usage_day)
  );

  CREATE TABLE IF NOT EXISTS funnel_events (
    id SERIAL PRIMARY KEY,
    visitor_key TEXT NOT NULL,
    event_type TEXT NOT NULL,
    meta TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_funnel_events_type ON funnel_events(event_type, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_funnel_events_visitor ON funnel_events(visitor_key, event_type);
`;

async function migrateSchema() {
  if (driver === 'postgres') {
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS unlocked_at TIMESTAMPTZ');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS funnel_events (
        id SERIAL PRIMARY KEY,
        visitor_key TEXT NOT NULL,
        event_type TEXT NOT NULL,
        meta TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_funnel_events_type ON funnel_events(event_type, created_at DESC)'
    );
    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_funnel_events_visitor ON funnel_events(visitor_key, event_type)'
    );
    return;
  }

  const cols = sqlite.prepare('PRAGMA table_info(users)').all();
  if (!cols.some((c) => c.name === 'unlocked_at')) {
    sqlite.exec('ALTER TABLE users ADD COLUMN unlocked_at TEXT');
  }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS funnel_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visitor_key TEXT NOT NULL,
      event_type TEXT NOT NULL,
      meta TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_funnel_events_type ON funnel_events(event_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_funnel_events_visitor ON funnel_events(visitor_key, event_type);
  `);
}

export async function initStore() {
  if (process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: pgSsl(),
    });
    await pool.query(PG_SCHEMA);
    driver = 'postgres';
    await migrateSchema();
    console.log('Database: PostgreSQL (DATABASE_URL)');
    return;
  }

  sqlitePath = path.join(dataDir, 'wavtomp3.db');
  sqlite = new Database(sqlitePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.exec(SQLITE_SCHEMA);
  driver = 'sqlite';
  await migrateSchema();
  console.log(`Database: SQLite at ${sqlitePath}`);

  if (process.env.RAILWAY_ENVIRONMENT && !process.env.DATA_DIR) {
    console.warn(
      'WARNING: Running on Railway without DATABASE_URL or DATA_DIR. SQLite data will be lost on redeploy. Add Railway Postgres or mount a volume at /data and set DATA_DIR=/data.'
    );
  }
}

export function getStoreInfo() {
  return {
    driver,
    dataDir,
    sqlitePath: driver === 'sqlite' ? sqlitePath : null,
    postgres: driver === 'postgres',
  };
}

export async function dbGet(sql, params = []) {
  if (driver === 'postgres') {
    const result = await pool.query(toPgSql(sql), params);
    return result.rows[0] ?? null;
  }
  return sqlite.prepare(sql).get(...params) ?? null;
}

export async function dbAll(sql, params = []) {
  if (driver === 'postgres') {
    const result = await pool.query(toPgSql(sql), params);
    return result.rows;
  }
  return sqlite.prepare(sql).all(...params);
}

export async function dbRun(sql, params = []) {
  if (driver === 'postgres') {
    const result = await pool.query(toPgSql(sql), params);
    return { changes: result.rowCount };
  }
  return sqlite.prepare(sql).run(...params);
}

export async function dbInsertReturningId(sql, params = []) {
  if (driver === 'postgres') {
    const result = await pool.query(toPgSql(sql), params);
    return Number(result.rows[0]?.id);
  }
  const info = sqlite.prepare(sql).run(...params);
  return Number(info.lastInsertRowid);
}

export function isPostgres() {
  return driver === 'postgres';
}

export async function getHealthInfo() {
  let userCount = 0;
  let writable = false;

  try {
    if (driver === 'postgres') {
      const result = await pool.query('SELECT COUNT(*)::int AS n FROM users');
      userCount = result.rows[0].n;
      writable = true;
    } else {
      userCount = sqlite.prepare('SELECT COUNT(*) AS n FROM users').get().n;
      const probe = path.join(dataDir, '.write-test');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      writable = true;
    }
  } catch (err) {
    return { ok: false, error: err.message, ...getStoreInfo() };
  }

  return { ok: true, userCount, writable, ...getStoreInfo() };
}
