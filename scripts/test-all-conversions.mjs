#!/usr/bin/env node
/**
 * Browser conversion smoke test — runs local WASM conversions for every supported route.
 * Usage: node scripts/test-all-conversions.mjs [--port=3002]
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  WAV_ROUTES,
  M4A_ROUTES,
  MP4_ROUTES,
  AAC_ROUTES,
  MP3_ROUTES,
  OGG_ROUTES,
  WMA_ROUTES,
  getInputFormat,
} from '../public/conversion-formats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const fixturesDir = path.join(root, 'test-fixtures');

const portArg = process.argv.find((a) => a.startsWith('--port='));
const port = portArg ? Number(portArg.split('=')[1]) : 3002;
const baseUrl = `http://localhost:${port}`;

const ALL_ROUTE_GROUPS = [
  ['wav', WAV_ROUTES],
  ['m4a', M4A_ROUTES],
  ['mp4', MP4_ROUTES],
  ['aac', AAC_ROUTES],
  ['mp3', MP3_ROUTES],
  ['ogg', OGG_ROUTES],
  ['wma', WMA_ROUTES],
];

function localRoutes() {
  const routes = [];
  for (const [, group] of ALL_ROUTE_GROUPS) {
    for (const route of group) {
      const input = getInputFormat(route.inputSlug);
      if (input.localSupported === false || route.localSupported === false) continue;
      routes.push(route);
    }
  }
  return routes;
}

function ensureFixtures() {
  fs.mkdirSync(fixturesDir, { recursive: true });
  const wav = path.join(fixturesDir, 'sample.wav');
  if (!fs.existsSync(wav)) {
    execSync(
      `ffmpeg -y -f lavfi -i "sine=frequency=440:duration=2" -ac 2 -ar 44100 "${wav}"`,
      { stdio: 'ignore' }
    );
  }
  const specs = [
    ['sample.mp3', '-codec:a libmp3lame -b:a 128k'],
    ['sample.m4a', '-codec:a aac -b:a 128k'],
    ['sample.mp4', '-codec:a aac -b:a 128k -vn'],
    ['sample.aac', '-codec:a aac -b:a 128k -f adts'],
    ['sample.ogg', ['-codec:a', 'vorbis', '-q:a', '4', '-strict', '-2']],
    ['sample.flac', '-codec:a flac'],
  ];
  for (const [name, args] of specs) {
    const out = path.join(fixturesDir, name);
    if (!fs.existsSync(out)) {
      execSync(`ffmpeg -y -i "${wav}" ${args} "${out}"`, { stdio: 'ignore' });
    }
  }
}

function fixtureForInput(slug) {
  const map = {
    wav: 'sample.wav',
    mp3: 'sample.mp3',
    m4a: 'sample.m4a',
    mp4: 'sample.mp4',
    aac: 'sample.aac',
    ogg: 'sample.ogg',
    wma: 'sample.wma',
  };
  const file = path.join(fixturesDir, map[slug] || `sample.${slug}`);
  if (!fs.existsSync(file)) return null;
  return file;
}

async function waitForServer(ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(`${baseUrl}/`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server not reachable at ${baseUrl}`);
}

function startServer() {
  const child = spawn('node', ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), STRIPE_SECRET_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return child;
}

async function runConversion(page, route) {
  const fixture = fixtureForInput(route.inputSlug);
  if (!fixture) {
    return { skipped: true, reason: 'no fixture' };
  }

  await page.goto(`${baseUrl}${route.path}`, { waitUntil: 'networkidle' });
  await page.setInputFiles('#fileInput', fixture);
  await page.waitForFunction(() => {
    const btn = document.getElementById('goBtn');
    return btn && !btn.disabled;
  }, { timeout: 120000 });

  await page.click('#goBtn');
  await page.waitForSelector('.result-card .result-banner strong', { timeout: 180000 });
  await page.waitForFunction(
    () => document.querySelector('.result-card .result-banner strong')?.textContent === 'Conversion complete',
    { timeout: 180000 }
  );

  const blobInfo = await page.evaluate(async () => {
    const urls = window.__testBlobUrls || [];
    if (!urls.length) return { size: 0, count: 0 };
    const last = urls[urls.length - 1];
    const res = await fetch(last);
    const buf = await res.arrayBuffer();
    return { size: buf.byteLength, count: urls.length };
  });

  return { skipped: false, size: blobInfo.size };
}

async function main() {
  ensureFixtures();

  let server = null;
  let startedServer = false;
  try {
    await waitForServer(2000);
  } catch {
    server = startServer();
    startedServer = true;
    await waitForServer(20000);
  }

  const routes = localRoutes();
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.addInitScript(() => {
    window.__testBlobUrls = [];
    const orig = URL.createObjectURL;
    URL.createObjectURL = function createTrackedBlobUrl(blob) {
      const url = orig.call(this, blob);
      window.__testBlobUrls.push(url);
      window.__testBlobLastSize = blob?.size ?? 0;
      return url;
    };
  });

  const results = [];
  console.log(`Testing ${routes.length} local conversion routes at ${baseUrl}…\n`);

  for (const route of routes) {
    const label = `${route.inputSlug}-to-${route.slug}`;
    process.stdout.write(`${label} … `);
    try {
      const result = await runConversion(page, route);
      if (result.skipped) {
        console.log(`SKIP (${result.reason})`);
        results.push({ label, status: 'skip', ...result });
        continue;
      }
      if (result.size > 0) {
        console.log(`OK (${result.size} bytes)`);
        results.push({ label, status: 'ok', size: result.size });
      } else {
        console.log('FAIL (0 bytes)');
        results.push({ label, status: 'fail', size: 0 });
      }
    } catch (err) {
      console.log(`FAIL (${err.message})`);
      results.push({ label, status: 'fail', error: err.message });
    }
  }

  await browser.close();
  if (startedServer && server) server.kill('SIGTERM');

  const failed = results.filter((r) => r.status === 'fail');
  const passed = results.filter((r) => r.status === 'ok');
  const skipped = results.filter((r) => r.status === 'skip');

  console.log('\n--- Summary ---');
  console.log(`Passed: ${passed.length}`);
  console.log(`Failed: ${failed.length}`);
  console.log(`Skipped: ${skipped.length}`);

  if (failed.length) {
    console.log('\nFailures:');
    for (const f of failed) {
      console.log(`  ${f.label}: ${f.error || `${f.size} bytes`}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
