import 'dotenv/config';
import { ZipArchive } from 'archiver';
import crypto from 'crypto';
import express from 'express';
import multer from 'multer';
import cookieParser from 'cookie-parser';
import Stripe from 'stripe';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  findUserByEmail,
  findUserById,
  findUserAuthById,
  findUserByStripeCustomerId,
  createUser,
  updateUserPassword,
  updateUserStripeCustomerId,
  markCheckoutSessionUsed,
  isCheckoutSessionUsed,
  markUserUnlocked,
  countUsers,
} from './lib/db.js';
import {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  setAuthCookie,
  clearAuthCookie,
  requireAuth,
} from './lib/auth.js';
import { sealJobId, sealFileId, openJobToken, openFileToken } from './lib/convert-tokens.js';
import {
  hasPaidAccess,
  getAccessSummary,
  resolveUserStripeContext,
  cancelSubscriptionAtPeriodEnd,
  cancelSubscriptionImmediately,
  reactivateSubscription,
  resolvePaidCheckout,
  findStripeCustomerByEmail,
  listCustomerInvoices,
} from './lib/stripe-helpers.js';
import {
  createConversion,
  listConversions,
  getConversion,
  deleteConversion,
  userUploadDir,
} from './lib/conversions.js';
import {
  logConversionEvent,
  countConversionEventsForUser,
  getFormatStatsForUser,
  getRecentEventsForUser,
  getGlobalFormatStats,
  getConversionOverview,
} from './lib/conversion-events.js';
import {
  isAdminEmail,
  requireAdmin,
  listUsers,
  deleteUserAccount,
} from './lib/admin.js';
import { initStore, getHealthInfo } from './lib/store.js';
import {
  consumeFreeTier,
  getFreeTierStatus,
  resolveFreeTierIdentity,
} from './lib/free-tier.js';
import { convertPdfToEpub } from './lib/ebook-convert.js';
import { cleanUrlMiddleware } from './lib/clean-urls.js';
import { pagePath } from './lib/page-paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3002;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

/** Public site URL for Stripe redirects — prefer the domain the user is actually on. */
function getPublicBaseUrl(req) {
  if (req) {
    const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
    const proto = (req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http'))
      .split(',')[0]
      .trim();
    if (host) return `${proto}://${host}`;
  }
  return BASE_URL;
}
const ZAMZAR_API_KEY = process.env.ZAMZAR_API_KEY;
const ZAMZAR_API_BASE = process.env.ZAMZAR_API_BASE || 'https://api.zamzar.com/v1';

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
});

const libraryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

const ebookUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

const app = express();
app.set('trust proxy', 1);

function zamzarAuth() {
  return 'Basic ' + Buffer.from(`${ZAMZAR_API_KEY}:`).toString('base64');
}

const JOB_TIMEOUT_MS = 10 * 60 * 1000;

async function zamzarFetch(url, options = {}) {
  const headers = { Authorization: zamzarAuth(), ...options.headers };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zamzar error ${res.status}: ${body}`);
  }
  return res;
}

function isZamzarJobTimedOut(createdAt) {
  if (!createdAt) return false;
  const started = Date.parse(createdAt);
  if (Number.isNaN(started)) return false;
  return Date.now() - started > JOB_TIMEOUT_MS;
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.created_at,
  };
}

async function loadUserSubscription(user) {
  if (!stripe || !user) return { subscription: null, customerId: user?.stripe_customer_id || null };

  try {
    const ctx = await resolveUserStripeContext(stripe, user);
    if (ctx.relinked && ctx.customerId) {
      await updateUserStripeCustomerId(user.id, ctx.customerId);
      user.stripe_customer_id = ctx.customerId;
    }
    return { subscription: ctx.subscription, customerId: ctx.customerId };
  } catch (err) {
    console.error('Subscription lookup error:', err.message);
    return { subscription: null, customerId: user.stripe_customer_id };
  }
}

function authUserIdFromRequest(req) {
  const token = req.cookies?.wavtomp3_token;
  if (!token) return null;
  const payload = verifyToken(token);
  return payload?.sub ?? null;
}

async function loadFreeTierForRequest(req, res, { userId = null, subscriptionActive = false } = {}) {
  const identityKey = resolveFreeTierIdentity(req, res, userId);
  return getFreeTierStatus(identityKey, { unlimited: subscriptionActive });
}

/* ---------- Stripe webhook needs raw body ---------- */
app.post(
  '/api/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
      return res.status(503).json({ error: 'Stripe not configured' });
    }
    const sig = req.headers['stripe-signature'];
    try {
      stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    res.json({ received: true });
  }
);

app.use(cookieParser());
app.use(express.json());

/* Serve FFmpeg WASM from same origin (required for Web Workers) */
app.use('/vendor/@ffmpeg/ffmpeg', express.static(path.join(__dirname, 'node_modules/@ffmpeg/ffmpeg')));
app.use('/vendor/@ffmpeg/core', express.static(path.join(__dirname, 'node_modules/@ffmpeg/core')));
app.use('/vendor/@ffmpeg/util', express.static(path.join(__dirname, 'node_modules/@ffmpeg/util')));

app.use(cleanUrlMiddleware(__dirname));
app.use(express.static(__dirname));

/* ---------- Auth ---------- */
app.get('/api/checkout-session', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });

  const { session_id: sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ error: 'Missing session_id' });

  try {
    if (await isCheckoutSessionUsed(sessionId)) {
      return res.json({ valid: false, alreadyRegistered: true });
    }

    const checkout = await resolvePaidCheckout(stripe, sessionId);
    if (checkout.error) {
      return res.json({ valid: false, error: checkout.error });
    }

    const existing = await findUserByStripeCustomerId(checkout.customerId);
    if (existing) {
      return res.json({
        valid: false,
        alreadyRegistered: true,
        email: existing.email,
      });
    }

    res.json({
      valid: true,
      email: checkout.email,
      customerId: checkout.customerId,
    });
  } catch (err) {
    console.error('Checkout session lookup error:', err);
    res.status(500).json({ error: 'Failed to verify checkout' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });

  const { email, password, sessionId } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (await findUserByEmail(normalizedEmail)) {
    return res.status(409).json({ error: 'An account with this email already exists. Try logging in.' });
  }

  try {
    let customerId = null;
    let checkoutLifetime = false;

    if (sessionId) {
      if (await isCheckoutSessionUsed(sessionId)) {
        return res.status(409).json({ error: 'This payment has already been linked to an account. Try logging in.' });
      }

      const checkout = await resolvePaidCheckout(stripe, sessionId);
      if (checkout.error) {
        return res.status(400).json({ error: checkout.error });
      }

      if (await findUserByStripeCustomerId(checkout.customerId)) {
        return res.status(409).json({ error: 'This purchase is already linked to an account. Try logging in.' });
      }

      customerId = checkout.customerId;
      checkoutLifetime = !!checkout.lifetime;
    } else {
      const match = await findStripeCustomerByEmail(stripe, normalizedEmail);
      if (!match) {
        return res.status(400).json({
          error: 'No unlock purchase found for this email. Complete checkout first, or use the link from your payment confirmation.',
        });
      }
      if (await findUserByStripeCustomerId(match.customerId)) {
        return res.status(409).json({ error: 'This purchase is already linked to an account. Try logging in.' });
      }
      customerId = match.customerId;
    }

    const passwordHash = await hashPassword(password);
    const user = await createUser(normalizedEmail, passwordHash, customerId);

    if (sessionId) {
      await markCheckoutSessionUsed(sessionId, user.id);
      if (checkoutLifetime) await markUserUnlocked(user.id);
    } else {
      const access = await getAccessSummary(stripe, customerId);
      if (access?.lifetime) await markUserUnlocked(user.id);
    }

    const token = signToken(user);
    setAuthCookie(res, token);

    res.json({
      user: publicUser(user),
      subscriptionActive: true,
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Could not create account' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = await findUserByEmail(normalizedEmail);
  if (!user) {
    if (stripe) {
      try {
        const match = await findStripeCustomerByEmail(stripe, normalizedEmail);
        if (match && !(await findUserByStripeCustomerId(match.customerId))) {
          return res.status(401).json({
            error:
              'No account exists for this email yet, but you have an active unlock. Create your account using the same email you paid with.',
            needsRegistration: true,
          });
        }
      } catch (err) {
        console.error('Stripe lookup during login:', err.message);
      }
    }
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const subscriptionActive = stripe
    ? (await loadUserSubscription(user)).subscription?.active ?? false
    : false;

  const token = signToken(user);
  setAuthCookie(res, token);

  res.json({
    user: publicUser(user),
    subscriptionActive,
  });
});

app.post('/api/auth/reset-password', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });

  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and new password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = await findUserByEmail(normalizedEmail);

  if (!user) {
    try {
      const match = await findStripeCustomerByEmail(stripe, normalizedEmail);
      if (match && !(await findUserByStripeCustomerId(match.customerId))) {
        return res.status(404).json({
          error:
            'No account exists for this email yet, but you have an active unlock. Create your account using the same email you paid with.',
          needsRegistration: true,
        });
      }
    } catch (err) {
      console.error('Stripe lookup during password reset:', err.message);
    }
    return res.status(404).json({ error: 'No account found for this email.' });
  }

  try {
    let subscriptionActive = false;

    if (user.unlocked_at) {
      subscriptionActive = true;
    } else if (user.stripe_customer_id) {
      subscriptionActive = await hasPaidAccess(stripe, user.stripe_customer_id);
    }
    if (!subscriptionActive) {
      const match = await findStripeCustomerByEmail(stripe, normalizedEmail);
      subscriptionActive = !!match;
    }

    if (!subscriptionActive) {
      return res.status(403).json({
        error: 'No active unlock found for this email. Reset is only available for paying customers.',
      });
    }

    const passwordHash = await hashPassword(password);
    await updateUserPassword(user.id, passwordHash);

    const token = signToken(user);
    setAuthCookie(res, token);

    res.json({
      ok: true,
      user: publicUser(user),
      subscriptionActive: true,
    });
  } catch (err) {
    console.error('Password reset error:', err);
    res.status(500).json({ error: 'Could not reset password' });
  }
});

app.post('/api/auth/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', async (req, res) => {
  const token = req.cookies?.wavtomp3_token;
  if (!token) return res.json({ user: null, subscriptionActive: false });

  const payload = verifyToken(token);
  if (!payload) {
    clearAuthCookie(res);
    return res.json({ user: null, subscriptionActive: false });
  }

  const user = await findUserById(payload.sub);
  if (!user) {
    clearAuthCookie(res);
    return res.json({ user: null, subscriptionActive: false });
  }

  const { subscription } = await loadUserSubscription(user);
  const subscriptionActive = subscription?.active ?? false;
  const freeTier = await loadFreeTierForRequest(req, res, {
    userId: user.id,
    subscriptionActive,
  });

  res.json({
    user: publicUser(user),
    subscriptionActive,
    subscription,
    freeTier,
  });
});

app.get('/api/free-tier', async (req, res) => {
  try {
    const userId = authUserIdFromRequest(req);
    let subscriptionActive = false;

    if (userId) {
      const user = await findUserById(userId);
      if (user) {
        const { subscription } = await loadUserSubscription(user);
        subscriptionActive = subscription?.active ?? false;
      }
    }

    const freeTier = await loadFreeTierForRequest(req, res, { userId, subscriptionActive });
    res.json(freeTier);
  } catch (err) {
    console.error('Free tier status error:', err);
    res.status(500).json({ error: 'Failed to load free tier status' });
  }
});

app.post('/api/free-tier/consume', async (req, res) => {
  try {
    const userId = authUserIdFromRequest(req);
    let subscriptionActive = false;

    if (userId) {
      const user = await findUserById(userId);
      if (user) {
        const { subscription } = await loadUserSubscription(user);
        subscriptionActive = subscription?.active ?? false;
      }
    }

    if (subscriptionActive) {
      const freeTier = await loadFreeTierForRequest(req, res, {
        userId,
        subscriptionActive: true,
      });
      return res.json({ ok: true, consumed: 1, ...freeTier });
    }

    const amount = Math.min(Math.max(Number(req.body?.count) || 1, 1), 5);
    const identityKey = resolveFreeTierIdentity(req, res, userId);
    const result = await consumeFreeTier(identityKey, amount);

    if (!result.ok) {
      return res.status(403).json(result);
    }

    res.json(result);
  } catch (err) {
    console.error('Free tier consume error:', err);
    res.status(500).json({ error: 'Failed to update free tier usage' });
  }
});

app.post('/api/account/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'New password must be different from your current password' });
  }

  const user = await findUserAuthById(req.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const valid = await verifyPassword(currentPassword, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  try {
    const passwordHash = await hashPassword(newPassword);
    await updateUserPassword(req.userId, passwordHash);
    res.json({ ok: true });
  } catch (err) {
    console.error('Password change error:', err);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

app.get('/api/account/invoices', requireAuth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });

  const user = await findUserById(req.userId);
  if (!user?.stripe_customer_id) {
    return res.json({ invoices: [] });
  }

  try {
    const invoices = await listCustomerInvoices(stripe, user.stripe_customer_id);
    res.json({ invoices });
  } catch (err) {
    console.error('Invoices error:', err);
    res.status(500).json({ error: 'Failed to load invoices' });
  }
});

app.post('/api/account/cancel-subscription', requireAuth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });

  const user = await findUserById(req.userId);
  if (!user?.stripe_customer_id) {
    return res.status(400).json({ error: 'No subscription linked to this account' });
  }

  try {
    const result = await cancelSubscriptionAtPeriodEnd(stripe, user.stripe_customer_id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true, subscription: result.subscription });
  } catch (err) {
    console.error('Cancel subscription error:', err);
    res.status(500).json({ error: err.message || 'Failed to cancel subscription' });
  }
});

app.post('/api/account/reactivate-subscription', requireAuth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });

  const user = await findUserById(req.userId);
  if (!user?.stripe_customer_id) {
    return res.status(400).json({ error: 'No subscription linked to this account' });
  }

  try {
    const result = await reactivateSubscription(stripe, user.stripe_customer_id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true, subscription: result.subscription });
  } catch (err) {
    console.error('Reactivate subscription error:', err);
    res.status(500).json({ error: err.message || 'Failed to reactivate subscription' });
  }
});

/* ---------- My files library ---------- */
app.post('/api/files', requireAuth, libraryUpload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const mode = req.body.mode === 'server' ? 'server' : 'local';
  const originalName = req.body.originalName || 'audio.wav';
  const outputName = req.body.outputName || req.file.originalname || 'converted.mp3';
  const duration = parseFloat(req.body.duration) || 0;

  try {
    const dir = userUploadDir(req.userId);
    const ext = path.extname(outputName) || '.bin';
    const filename = `${crypto.randomUUID()}${ext}`;
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, req.file.buffer);

    const record = await createConversion({
      userId: req.userId,
      originalName,
      outputName,
      mode,
      fileSize: req.file.size,
      duration,
      filePath,
    });

    res.json(record);
  } catch (err) {
    console.error('Save file error:', err);
    res.status(500).json({ error: 'Failed to save file' });
  }
});

app.get('/api/files', requireAuth, async (req, res) => {
  res.json({ files: await listConversions(req.userId) });
});

app.post('/api/files/download-batch', requireAuth, async (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No files selected' });
  }

  const files = (
    await Promise.all(ids.map((id) => getConversion(req.userId, Number(id))))
  ).filter((f) => f?.filePath && fs.existsSync(f.filePath));

  if (!files.length) {
    return res.status(410).json({ error: 'No available files to download' });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="youconvert-${stamp}.zip"`);

  const archive = new ZipArchive({ zlib: { level: 5 } });
  archive.on('error', (err) => {
    console.error('ZIP error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to create ZIP archive' });
    } else {
      res.end();
    }
  });
  archive.pipe(res);

  const usedNames = new Map();
  for (const file of files) {
    let name = file.outputName || 'audio.mp3';
    const count = usedNames.get(name) || 0;
    if (count > 0) {
      const ext = path.extname(name);
      const base = path.basename(name, ext);
      name = `${base}-${count}${ext}`;
    }
    usedNames.set(file.outputName, count + 1);
    archive.file(file.filePath, { name });
  }

  archive.finalize();
});

app.get('/api/files/:id/download', requireAuth, async (req, res) => {
  const conv = await getConversion(req.userId, Number(req.params.id));
  if (!conv) {
    return res.status(404).json({ error: 'File not found' });
  }
  if (!conv.filePath || !fs.existsSync(conv.filePath)) {
    return res.status(410).json({ error: 'File no longer available on the server' });
  }
  res.download(conv.filePath, conv.outputName);
});

app.delete('/api/files/:id', requireAuth, async (req, res) => {
  const ok = await deleteConversion(req.userId, Number(req.params.id));
  if (!ok) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.json({ ok: true });
});

/* ---------- Ebook (Calibre) ---------- */
app.post('/api/convert/ebook', ebookUpload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const name = (req.file.originalname || '').toLowerCase();
  if (!name.endsWith('.pdf')) {
    return res.status(400).json({ error: 'Only PDF files are supported' });
  }

  let options = {};
  if (req.body.options) {
    try {
      options = JSON.parse(req.body.options);
    } catch {
      return res.status(400).json({ error: 'Invalid conversion options' });
    }
  }

  try {
    const epubBuffer = await convertPdfToEpub(req.file.buffer, req.file.originalname, options);
    const baseName = path.basename(req.file.originalname, path.extname(req.file.originalname));
    const safeName = (baseName || 'document').replace(/[^\w.\-()+ ]/g, '_');
    res.setHeader('Content-Type', 'application/epub+zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.epub"`);
    res.send(epubBuffer);
  } catch (err) {
    console.error('Ebook conversion error:', err);
    res.status(500).json({ error: err.message || 'Conversion failed' });
  }
});

/* ---------- Zamzar ---------- */
app.post('/api/convert/server', upload.single('file'), async (req, res) => {
  if (!ZAMZAR_API_KEY) {
    return res.status(503).json({ error: 'Zamzar API not configured' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const form = new FormData();
    form.append(
      'source_file',
      new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/wav' }),
      req.file.originalname
    );
    const targetFormat = (req.body.target_format || 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '');
    form.append('target_format', targetFormat || 'mp3');

    const jobRes = await zamzarFetch(`${ZAMZAR_API_BASE}/jobs`, {
      method: 'POST',
      body: form,
    });
    const job = await jobRes.json();
    res.json({ jobToken: sealJobId(job.id) });
  } catch (err) {
    console.error('Zamzar upload error:', err);
    res.status(500).json({ error: err.message || 'Conversion failed to start' });
  }
});

app.get('/api/convert/status/:token', async (req, res) => {
  if (!ZAMZAR_API_KEY) {
    return res.status(503).json({ error: 'Zamzar API not configured' });
  }

  let jobId;
  try {
    jobId = openJobToken(req.params.token);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Invalid job token' });
  }

  try {
    const jobRes = await zamzarFetch(`${ZAMZAR_API_BASE}/jobs/${jobId}`);
    const job = await jobRes.json();

    if (job.status === 'successful' && job.target_files?.length) {
      return res.json({ status: 'successful', fileToken: sealFileId(job.target_files[0].id) });
    }
    if (job.status === 'failed') {
      return res.json({ status: 'failed', error: job.failure?.message || 'Conversion failed' });
    }
    if (isZamzarJobTimedOut(job.created_at)) {
      return res.json({ status: 'failed', error: 'Conversion timed out after 10 minutes' });
    }
    res.json({ status: job.status || 'processing' });
  } catch (err) {
    console.error('Zamzar status error:', err);
    res.status(500).json({ error: err.message || 'Failed to check status' });
  }
});

app.get('/api/convert/download/:token', async (req, res) => {
  if (!ZAMZAR_API_KEY) {
    return res.status(503).json({ error: 'Zamzar API not configured' });
  }

  let fileId;
  try {
    fileId = openFileToken(req.params.token);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Invalid file token' });
  }

  try {
    const fileRes = await zamzarFetch(
      `${ZAMZAR_API_BASE}/files/${fileId}/content`
    );
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    const ext = (req.query.ext || 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp3';
    const mimeTypes = {
      mp3: 'audio/mpeg',
      aac: 'audio/aac',
      flac: 'audio/flac',
      m4a: 'audio/mp4',
      m4r: 'audio/mp4',
      mp4: 'audio/mp4',
      ogg: 'audio/ogg',
      wma: 'audio/x-ms-wma',
    };
    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="converted.${ext}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Zamzar download error:', err);
    res.status(500).json({ error: err.message || 'Download failed' });
  }
});

function safeReturnPath(returnTo) {
  if (!returnTo || typeof returnTo !== 'string') return '/';
  const path = returnTo.split('#')[0];
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) return '/';
  return path;
}

/* ---------- Stripe checkout ---------- */
app.post('/api/create-checkout-session', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const { returnTo } = req.body;
  const priceId = process.env.STRIPE_PRICE_UNLOCK || process.env.STRIPE_PRICE_MONTHLY;

  if (!priceId) {
    return res.status(503).json({ error: 'Stripe unlock price ID not configured' });
  }

  const returnPath = safeReturnPath(returnTo);
  const returnQuery = encodeURIComponent(returnPath);
  const siteUrl = getPublicBaseUrl(req);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_creation: 'always',
      success_url: `${siteUrl}${pagePath('create-account')}?session_id={CHECKOUT_SESSION_ID}&return_to=${returnQuery}`,
      cancel_url: `${siteUrl}${returnPath}${returnPath.includes('?') ? '&' : '?'}checkout=cancelled`,
      allow_promotion_codes: true,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    res.status(500).json({ error: err.message || 'Checkout failed' });
  }
});

app.get('/api/verify-checkout', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const { session_id: sessionId } = req.query;
  if (!sessionId) {
    return res.status(400).json({ error: 'Missing session_id' });
  }

  try {
    const checkout = await resolvePaidCheckout(stripe, sessionId);
    if (checkout.error) {
      return res.json({ active: false, error: checkout.error });
    }

    const existing = await findUserByStripeCustomerId(checkout.customerId);
    res.json({
      active: checkout.active,
      customerId: checkout.customerId,
      needsAccount: !existing,
      alreadyRegistered: !!existing,
    });
  } catch (err) {
    console.error('Verify checkout error:', err);
    res.status(500).json({ error: err.message || 'Verification failed' });
  }
});

app.get('/api/subscription/status', async (req, res) => {
  if (!stripe) {
    return res.json({ active: false });
  }

  const { customer_id: customerId } = req.query;
  if (!customerId) {
    return res.json({ active: false });
  }

  try {
    const active = await hasPaidAccess(stripe, customerId);
    res.json({ active });
  } catch (err) {
    console.error('Subscription status error:', err);
    res.json({ active: false });
  }
});

app.get('/api/config', (_req, res) => {
  res.json({
    zamzar: !!ZAMZAR_API_KEY,
    stripe: !!stripe,
  });
});

app.get('/api/health', async (_req, res) => {
  res.json(await getHealthInfo());
});

/* ---------- Conversion analytics ---------- */
app.post('/api/events/conversion', async (req, res) => {
  const { inputFormat, outputFormat, mode, fileSize, duration, savedToLibrary } = req.body || {};
  if (!inputFormat || !outputFormat || !mode) {
    return res.status(400).json({ error: 'inputFormat, outputFormat and mode are required' });
  }
  if (mode !== 'local' && mode !== 'server') {
    return res.status(400).json({ error: 'Invalid mode' });
  }

  let userId = null;
  const token = req.cookies?.wavtomp3_token;
  if (token) {
    const payload = verifyToken(token);
    if (payload) userId = payload.sub;
  }

  try {
    await logConversionEvent({
      userId,
      inputFormat: String(inputFormat).toLowerCase().replace(/[^a-z0-9]/g, ''),
      outputFormat: String(outputFormat).toLowerCase().replace(/[^a-z0-9]/g, ''),
      mode,
      fileSize: fileSize ? Number(fileSize) : null,
      duration: duration ? Number(duration) : null,
      savedToLibrary: !!savedToLibrary,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Conversion event error:', err);
    res.status(500).json({ error: 'Failed to log conversion' });
  }
});

/* ---------- Admin ---------- */
app.get('/api/admin/me', requireAuth, (req, res) => {
  res.json({ admin: isAdminEmail(req.userEmail) });
});

app.get('/api/admin/overview', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const conversions = await getConversionOverview();
    const formatStats = await getGlobalFormatStats();
    let activeSubscriptions = 0;

    if (stripe) {
      const users = (await listUsers({ limit: 500, offset: 0 })).users;
      const checks = await Promise.all(
        users
          .filter((u) => u.stripeCustomerId)
          .map((u) => hasPaidAccess(stripe, u.stripeCustomerId).catch(() => false))
      );
      activeSubscriptions = checks.filter(Boolean).length;
    }

    res.json({
      totalUsers: await countUsers(),
      activeSubscriptions,
      conversions,
      topFormats: formatStats,
    });
  } catch (err) {
    console.error('Admin overview error:', err);
    res.status(500).json({ error: 'Failed to load overview' });
  }
});

app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const search = req.query.q || '';
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  res.json(await listUsers({ search, limit, offset }));
});

app.get('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const user = await findUserById(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    const { subscription, customerId } = await loadUserSubscription(user);
    const invoices =
      stripe && customerId ? await listCustomerInvoices(stripe, customerId) : [];

    const formatStats = await getFormatStatsForUser(userId);
    res.json({
      user: publicUser(user),
      stripeCustomerId: customerId || user.stripe_customer_id,
      subscription,
      invoices,
      conversionCount: await countConversionEventsForUser(userId),
      formatStats: formatStats.map((row) => ({
        inputFormat: row.input_format,
        outputFormat: row.output_format,
        mode: row.mode,
        count: Number(row.count),
      })),
      recentConversions: await getRecentEventsForUser(userId),
      libraryFiles: await listConversions(userId),
    });
  } catch (err) {
    console.error('Admin user detail error:', err);
    res.status(500).json({ error: 'Failed to load user' });
  }
});

app.post('/api/admin/users/:id/password', requireAuth, requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const { newPassword } = req.body || {};
  if (!(await findUserById(userId))) return res.status(404).json({ error: 'User not found' });
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const passwordHash = await hashPassword(newPassword);
    await updateUserPassword(userId, passwordHash);
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin password reset error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

app.post('/api/admin/users/:id/cancel-subscription', requireAuth, requireAdmin, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });

  const user = await findUserById(Number(req.params.id));
  if (!user?.stripe_customer_id) {
    return res.status(400).json({ error: 'No subscription linked to this account' });
  }

  const immediate = req.body?.immediate === true;

  try {
    const result = immediate
      ? await cancelSubscriptionImmediately(stripe, user.stripe_customer_id)
      : await cancelSubscriptionAtPeriodEnd(stripe, user.stripe_customer_id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true, subscription: result.subscription });
  } catch (err) {
    console.error('Admin cancel subscription error:', err);
    res.status(500).json({ error: err.message || 'Failed to cancel subscription' });
  }
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const user = await findUserById(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (userId === req.userId) {
    return res.status(400).json({ error: 'You cannot delete your own admin account from here' });
  }

  try {
    if (stripe && user.stripe_customer_id && req.body?.cancelStripe) {
      await cancelSubscriptionImmediately(stripe, user.stripe_customer_id).catch(() => {});
    }
    const ok = await deleteUserAccount(userId);
    if (!ok) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin delete user error:', err);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

app.get('/api/admin/payments', requireAuth, requireAdmin, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });

  const limit = Math.min(Number(req.query.limit) || 50, 100);

  try {
    const invoices = await stripe.invoices.list({
      limit,
      expand: ['data.customer'],
    });

    const payments = await Promise.all(
      invoices.data.map(async (inv) => {
        const customer = inv.customer;
        const customerId = typeof customer === 'string' ? customer : customer?.id;
        const user = customerId ? await findUserByStripeCustomerId(customerId) : null;
        return {
          id: inv.id,
          number: inv.number,
          date: inv.created,
          amount: inv.amount_paid,
          currency: inv.currency,
          status: inv.status,
          customerEmail: typeof customer === 'object' && !customer.deleted ? customer.email : null,
          userId: user?.id ?? null,
          userEmail: user?.email ?? null,
          pdfUrl: inv.invoice_pdf,
          hostedUrl: inv.hosted_invoice_url,
        };
      })
    );
    res.json({ payments });
  } catch (err) {
    console.error('Admin payments error:', err);
    res.status(500).json({ error: 'Failed to load payments' });
  }
});

try {
  await initStore();
  app.listen(PORT, () => {
    console.log(`YouConvert server running at ${BASE_URL}`);
  });
} catch (err) {
  console.error('Failed to start server:', err);
  process.exit(1);
}
