import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const KEY_SALT = 'wavtomp3-convert-v1';

function getKey() {
  const secret = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  return crypto.scryptSync(secret, KEY_SALT, 32);
}

function seal(payload) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const plaintext = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

function open(token, expectedType) {
  let buf;
  try {
    buf = Buffer.from(token, 'base64url');
  } catch {
    throw new Error('Invalid token');
  }

  if (buf.length <= IV_LENGTH + TAG_LENGTH) {
    throw new Error('Invalid token');
  }

  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);

  let payload;
  try {
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    payload = JSON.parse(plaintext);
  } catch {
    throw new Error('Invalid token');
  }

  if (payload.t !== expectedType || !payload.id) {
    throw new Error('Invalid token');
  }
  if (!payload.exp || payload.exp < Date.now()) {
    throw new Error('Token expired');
  }

  return String(payload.id);
}

export function sealJobId(jobId) {
  return seal({ t: 'job', id: String(jobId), exp: Date.now() + TOKEN_TTL_MS });
}

export function sealFileId(fileId) {
  return seal({ t: 'file', id: String(fileId), exp: Date.now() + TOKEN_TTL_MS });
}

export function openJobToken(token) {
  return open(token, 'job');
}

export function openFileToken(token) {
  return open(token, 'file');
}
