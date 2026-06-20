#!/usr/bin/env node
/** Quick WASM smoke test for container outputs and MP3→M4A. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { findRoute } from '../public/conversion-formats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const port = 3011;
const baseUrl = `http://localhost:${port}`;
const fixturesDir = path.join(root, 'test-fixtures');

const CRITICAL = [
  'mp3-m4a',
  'wav-m4a',
  'wav-m4r',
  'wav-mp4',
  'mp3-mp4',
  'aac-m4a',
  'ogg-m4a',
  'm4a-mp3',
  'mp3-ogg',
];

async function waitForServer(ms = 20000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      if ((await fetch(`${baseUrl}/`)).ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('server timeout');
}

async function runOne(page, inputSlug, outputSlug) {
  const route = findRoute(inputSlug, outputSlug);
  const fixture = path.join(fixturesDir, `sample.${inputSlug}`);
  await page.goto(`${baseUrl}${route.path}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    window.__testBlobUrls = [];
    window.__testBlobLastSize = 0;
  });
  await page.setInputFiles('#fileInput', fixture);
  await page.waitForFunction(() => document.getElementById('goBtn') && !document.getElementById('goBtn').disabled, {
    timeout: 180000,
  });
  await page.click('#goBtn');
  await page.waitForFunction(
    () => document.querySelector('.result-card .result-banner strong')?.textContent === 'Conversion complete',
    { timeout: 180000 }
  );
  const size = await page.evaluate(() => window.__testBlobLastSize || 0);
  return size;
}

async function main() {
  const server = spawn('node', ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), STRIPE_SECRET_KEY: '' },
    stdio: 'ignore',
  });
  await waitForServer();

  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.__testBlobUrls = [];
    window.__testBlobLastSize = 0;
    const orig = URL.createObjectURL;
    URL.createObjectURL = function (blob) {
      const url = orig.call(this, blob);
      window.__testBlobLastSize = blob?.size ?? 0;
      window.__testBlobUrls.push(url);
      return url;
    };
  });

  const failed = [];
  for (const key of CRITICAL) {
    const [inputSlug, outputSlug] = key.split('-');
    process.stdout.write(`${inputSlug}-to-${outputSlug} … `);
    try {
      const size = await runOne(page, inputSlug, outputSlug);
      if (size > 0) console.log(`OK (${size} bytes)`);
      else {
        console.log('FAIL (0 bytes)');
        failed.push(key);
      }
    } catch (err) {
      console.log(`FAIL (${err.message})`);
      failed.push(key);
    }
  }

  await browser.close();
  server.kill('SIGTERM');
  if (failed.length) {
    console.log('\nFailed:', failed.join(', '));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
