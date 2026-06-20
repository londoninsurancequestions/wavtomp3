import crypto from 'crypto';
import { dbGet, dbRun } from './store.js';

export const FREE_DAILY_LIMIT = 5;
const ANON_COOKIE = 'yc_anon_id';

function utcDayString(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function nextUtcMidnightIso() {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}

export function ensureAnonId(req, res) {
  let id = req.cookies?.[ANON_COOKIE];
  if (!id) {
    id = crypto.randomUUID();
    res.cookie(ANON_COOKIE, id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 365 * 24 * 60 * 60 * 1000,
      path: '/',
    });
  }
  return id;
}

export function resolveFreeTierIdentity(req, res, userId = null) {
  if (userId) return `user:${userId}`;
  return `anon:${ensureAnonId(req, res)}`;
}

async function readUsage(identityKey, day = utcDayString()) {
  const row = await dbGet(
    'SELECT count FROM free_tier_usage WHERE identity_key = ? AND usage_day = ?',
    [identityKey, day]
  );
  return Number(row?.count ?? 0);
}

export function formatFreeTierStatus(used, { unlimited = false } = {}) {
  if (unlimited) {
    return {
      unlimited: true,
      limit: FREE_DAILY_LIMIT,
      used: 0,
      remaining: FREE_DAILY_LIMIT,
      resetsAt: nextUtcMidnightIso(),
    };
  }

  const safeUsed = Math.min(Math.max(used, 0), FREE_DAILY_LIMIT);
  return {
    unlimited: false,
    limit: FREE_DAILY_LIMIT,
    used: safeUsed,
    remaining: Math.max(FREE_DAILY_LIMIT - safeUsed, 0),
    resetsAt: nextUtcMidnightIso(),
  };
}

export async function getFreeTierStatus(identityKey, { unlimited = false } = {}) {
  if (unlimited) return formatFreeTierStatus(0, { unlimited: true });
  const used = await readUsage(identityKey);
  return formatFreeTierStatus(used);
}

export async function consumeFreeTier(identityKey, amount = 1) {
  const day = utcDayString();
  const used = await readUsage(identityKey, day);

  if (used >= FREE_DAILY_LIMIT) {
    return { ok: false, consumed: 0, ...formatFreeTierStatus(used) };
  }

  const consumed = Math.min(amount, FREE_DAILY_LIMIT - used);
  if (consumed <= 0) {
    return { ok: false, consumed: 0, ...formatFreeTierStatus(used) };
  }

  const existing = await dbGet(
    'SELECT count FROM free_tier_usage WHERE identity_key = ? AND usage_day = ?',
    [identityKey, day]
  );

  if (existing) {
    await dbRun(
      'UPDATE free_tier_usage SET count = count + ? WHERE identity_key = ? AND usage_day = ?',
      [consumed, identityKey, day]
    );
  } else {
    await dbRun(
      'INSERT INTO free_tier_usage (identity_key, usage_day, count) VALUES (?, ?, ?)',
      [identityKey, day, consumed]
    );
  }

  const newUsed = used + consumed;
  return { ok: true, consumed, ...formatFreeTierStatus(newUsed) };
}
