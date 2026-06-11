import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const COOKIE_NAME = 'wavtomp3_token';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function useSecureCookies() {
  if (process.env.COOKIE_SECURE === '1') return true;
  if (process.env.COOKIE_SECURE === '0') return false;
  if (process.env.NODE_ENV === 'production') return true;
  if (process.env.RAILWAY_ENVIRONMENT === 'production') return true;
  return (process.env.BASE_URL || '').startsWith('https://');
}

function cookieOptions() {
  const opts = {
    httpOnly: true,
    secure: useSecureCookies(),
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  };
  const host = process.env.COOKIE_DOMAIN || process.env.BASE_URL || '';
  if (host.includes('youconvert.com')) {
    opts.domain = '.youconvert.com';
  }
  return opts;
}

export function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, cookieOptions());
}

export function clearAuthCookie(res) {
  const { maxAge, ...clearOpts } = cookieOptions();
  res.clearCookie(COOKIE_NAME, clearOpts);
}

export function getTokenFromRequest(req) {
  return req.cookies?.[COOKIE_NAME] || null;
}

export function requireAuth(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const payload = verifyToken(token);
  if (!payload) {
    clearAuthCookie(res);
    return res.status(401).json({ error: 'Session expired' });
  }
  req.userId = payload.sub;
  req.userEmail = payload.email;
  next();
}

export { COOKIE_NAME };
