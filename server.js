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
  markCheckoutSessionUsed,
  isCheckoutSessionUsed,
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
  hasActiveSubscription,
  getSubscriptionSummary,
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3002;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
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

const app = express();

function zamzarAuth() {
  return 'Basic ' + Buffer.from(`${ZAMZAR_API_KEY}:`).toString('base64');
}

async function zamzarFetch(url, options = {}) {
  const headers = { Authorization: zamzarAuth(), ...options.headers };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zamzar error ${res.status}: ${body}`);
  }
  return res;
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.created_at,
  };
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

app.use(express.static(__dirname));

/* ---------- Auth ---------- */
app.get('/api/checkout-session', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });

  const { session_id: sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ error: 'Missing session_id' });

  try {
    if (isCheckoutSessionUsed(sessionId)) {
      return res.json({ valid: false, alreadyRegistered: true });
    }

    const checkout = await resolvePaidCheckout(stripe, sessionId);
    if (checkout.error) {
      return res.json({ valid: false, error: checkout.error });
    }

    const existing = findUserByStripeCustomerId(checkout.customerId);
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
  if (findUserByEmail(normalizedEmail)) {
    return res.status(409).json({ error: 'An account with this email already exists. Try logging in.' });
  }

  try {
    let customerId = null;

    if (sessionId) {
      if (isCheckoutSessionUsed(sessionId)) {
        return res.status(409).json({ error: 'This payment has already been linked to an account. Try logging in.' });
      }

      const checkout = await resolvePaidCheckout(stripe, sessionId);
      if (checkout.error) {
        return res.status(400).json({ error: checkout.error });
      }

      if (findUserByStripeCustomerId(checkout.customerId)) {
        return res.status(409).json({ error: 'This subscription is already linked to an account. Try logging in.' });
      }

      customerId = checkout.customerId;
    } else {
      const match = await findStripeCustomerByEmail(stripe, normalizedEmail);
      if (!match) {
        return res.status(400).json({
          error: 'No active subscription found for this email. Complete checkout first, or use the link from your payment confirmation.',
        });
      }
      if (findUserByStripeCustomerId(match.customerId)) {
        return res.status(409).json({ error: 'This subscription is already linked to an account. Try logging in.' });
      }
      customerId = match.customerId;
    }

    const passwordHash = await hashPassword(password);
    const user = createUser(normalizedEmail, passwordHash, customerId);

    if (sessionId) {
      markCheckoutSessionUsed(sessionId, user.id);
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

  const user = findUserByEmail(email.trim());
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const subscriptionActive = stripe
    ? await hasActiveSubscription(stripe, user.stripe_customer_id)
    : false;

  const token = signToken(user);
  setAuthCookie(res, token);

  res.json({
    user: publicUser(user),
    subscriptionActive,
  });
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

  const user = findUserById(payload.sub);
  if (!user) {
    clearAuthCookie(res);
    return res.json({ user: null, subscriptionActive: false });
  }

  const subscription = stripe
    ? await getSubscriptionSummary(stripe, user.stripe_customer_id)
    : null;

  res.json({
    user: publicUser(user),
    subscriptionActive: subscription?.active ?? false,
    subscription,
  });
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

  const user = findUserAuthById(req.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const valid = await verifyPassword(currentPassword, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  try {
    const passwordHash = await hashPassword(newPassword);
    updateUserPassword(req.userId, passwordHash);
    res.json({ ok: true });
  } catch (err) {
    console.error('Password change error:', err);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

app.get('/api/account/invoices', requireAuth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });

  const user = findUserById(req.userId);
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

/* ---------- My files library ---------- */
app.post('/api/files', requireAuth, libraryUpload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const mode = req.body.mode === 'server' ? 'server' : 'local';
  const originalName = req.body.originalName || 'audio.wav';
  const outputName = req.body.outputName || req.file.originalname || 'converted.mp3';
  const duration = parseFloat(req.body.duration) || 0;

  try {
    const dir = userUploadDir(req.userId);
    const filename = `${crypto.randomUUID()}.mp3`;
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, req.file.buffer);

    const record = createConversion({
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

app.get('/api/files', requireAuth, (req, res) => {
  res.json({ files: listConversions(req.userId) });
});

app.post('/api/files/download-batch', requireAuth, (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No files selected' });
  }

  const files = ids
    .map((id) => getConversion(req.userId, Number(id)))
    .filter((f) => f?.filePath && fs.existsSync(f.filePath));

  if (!files.length) {
    return res.status(410).json({ error: 'No available files to download' });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="wavtomp3-${stamp}.zip"`);

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

app.get('/api/files/:id/download', requireAuth, (req, res) => {
  const conv = getConversion(req.userId, Number(req.params.id));
  if (!conv) {
    return res.status(404).json({ error: 'File not found' });
  }
  if (!conv.filePath || !fs.existsSync(conv.filePath)) {
    return res.status(410).json({ error: 'File no longer available on the server' });
  }
  res.download(conv.filePath, conv.outputName);
});

app.delete('/api/files/:id', requireAuth, (req, res) => {
  const ok = deleteConversion(req.userId, Number(req.params.id));
  if (!ok) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.json({ ok: true });
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
    form.append('target_format', 'mp3');

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
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', 'attachment; filename="converted.mp3"');
    res.send(buffer);
  } catch (err) {
    console.error('Zamzar download error:', err);
    res.status(500).json({ error: err.message || 'Download failed' });
  }
});

/* ---------- Stripe checkout ---------- */
app.post('/api/create-checkout-session', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const { plan } = req.body;
  const priceId =
    plan === 'annual' ? process.env.STRIPE_PRICE_ANNUAL : process.env.STRIPE_PRICE_MONTHLY;

  if (!priceId) {
    return res.status(503).json({ error: 'Stripe price IDs not configured' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${BASE_URL}/create-account.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/?checkout=cancelled`,
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

    const existing = findUserByStripeCustomerId(checkout.customerId);
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
    const active = await hasActiveSubscription(stripe, customerId);
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

app.listen(PORT, () => {
  console.log(`WAVtoMP3 server running at ${BASE_URL}`);
});
