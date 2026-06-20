#!/usr/bin/env node
/**
 * CLI conversion smoke test — mirrors buildFfmpegArgs() with system ffmpeg.
 * Catches broken encoder/container combinations before browser testing.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
const outDir = path.join(root, 'test-fixtures', 'out');

const ALL_ROUTE_GROUPS = [
  WAV_ROUTES,
  M4A_ROUTES,
  MP4_ROUTES,
  AAC_ROUTES,
  MP3_ROUTES,
  OGG_ROUTES,
  WMA_ROUTES,
];

const defaultOpts = {
  bitrate: 256,
  encodingMode: 'CBR',
  channels: 'Stereo',
  sampleRate: 'keep',
  trim: false,
  normalize: false,
  fade: false,
};

function buildFfmpegArgs(inputExt, outputFormat, opts, duration) {
  const args = ['-i', `input.${inputExt}`];
  const outFile = `output.${outputFormat.ext}`;

  const filters = [];
  if (opts.normalize) filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  if (opts.fade) {
    const dur = duration || 0;
    const fadeOut = Math.max(0, dur - 2);
    filters.push('afade=t=in:st=0:d=2', `afade=t=out:st=${fadeOut}:d=2`);
  }
  if (filters.length) args.push('-af', filters.join(','));

  if (opts.sampleRate && opts.sampleRate !== 'keep') args.push('-ar', opts.sampleRate);
  if (opts.channels === 'Mono') args.push('-ac', '1');
  else args.push('-ac', '2');

  const inputFormat = getInputFormat(inputExt);
  if (outputFormat.audioOnly || inputFormat.stripVideo) args.push('-vn');

  if (outputFormat.isPcm) {
    args.push('-codec:a', 'pcm_s16le');
  } else {
    args.push('-codec:a', outputFormat.codec);
    if (outputFormat.lossless) {
      args.push('-compression_level', '8');
    } else if (outputFormat.codec === 'libmp3lame') {
      const mode = opts.encodingMode;
      if (mode === 'CBR') args.push('-b:a', `${opts.bitrate}k`);
      else if (mode === 'VBR (V0)') args.push('-q:a', '0');
      else if (mode === 'VBR (V2)') args.push('-q:a', '2');
      else if (mode === 'ABR') args.push('-abr', `${opts.bitrate}k`);
    } else if (outputFormat.codec === 'libvorbis') {
      args.push('-q:a', '6');
    } else {
      args.push('-b:a', `${opts.bitrate}k`);
    }
  }

  if (outputFormat.container) args.push('-f', 'mp4');

  args.push('-y', outFile);
  return { args, outFile };
}

function ensureFixtures() {
  fs.mkdirSync(fixturesDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  const wav = path.join(fixturesDir, 'sample.wav');
  if (!fs.existsSync(wav)) {
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ac', '2', '-ar', '44100', wav], {
      stdio: 'ignore',
    });
  }
  const specs = [
    ['sample.mp3', ['-codec:a', 'libmp3lame', '-b:a', '128k']],
    ['sample.m4a', ['-codec:a', 'aac', '-b:a', '128k']],
    ['sample.mp4', ['-codec:a', 'aac', '-b:a', '128k', '-vn']],
    ['sample.aac', ['-codec:a', 'aac', '-b:a', '128k', '-f', 'adts']],
    ['sample.ogg', ['-strict', '-2', '-codec:a', 'vorbis', '-q:a', '4']],
    ['sample.flac', ['-codec:a', 'flac']],
    ['sample.wma', ['-codec:a', 'wmav2', '-b:a', '128k']],
  ];
  for (const [name, extra] of specs) {
    const out = path.join(fixturesDir, name);
    if (!fs.existsSync(out)) {
      execFileSync('ffmpeg', ['-y', '-i', wav, ...extra, out], { stdio: 'ignore' });
    }
  }
}

function localRoutes() {
  const routes = [];
  for (const group of ALL_ROUTE_GROUPS) {
    for (const route of group) {
      const input = getInputFormat(route.inputSlug);
      if (input.localSupported === false || route.localSupported === false) continue;
      routes.push(route);
    }
  }
  return routes;
}

function fixtureForInput(slug) {
  return path.join(fixturesDir, `sample.${slug}`);
}

function main() {
  ensureFixtures();
  const routes = localRoutes();
  const results = [];

  console.log(`Testing ${routes.length} local routes with system ffmpeg…\n`);

  for (const route of routes) {
    const label = `${route.inputSlug}-to-${route.slug}`;
    const inputPath = fixtureForInput(route.inputSlug);
    const workDir = path.join(outDir, label);
    fs.mkdirSync(workDir, { recursive: true });

    const inputCopy = path.join(workDir, `input.${route.inputSlug}`);
    const { args, outFile } = buildFfmpegArgs(route.inputSlug, route, defaultOpts, 2);
    const outputPath = path.join(workDir, outFile);

    try {
      fs.copyFileSync(inputPath, inputCopy);
      execFileSync('ffmpeg', args, { cwd: workDir, stdio: 'pipe' });
      const size = fs.statSync(outputPath).size;
      if (size > 0) {
        console.log(`${label} … OK (${size} bytes)`);
        results.push({ label, status: 'ok', size });
      } else {
        console.log(`${label} … FAIL (0 bytes)`);
        results.push({ label, status: 'fail', size: 0 });
      }
    } catch (err) {
      const msg = err.stderr?.toString().split('\n').slice(-3).join(' ') || err.message;
      console.log(`${label} … FAIL (${msg})`);
      results.push({ label, status: 'fail', error: msg });
    }
  }

  const failed = results.filter((r) => r.status === 'fail');
  console.log('\n--- Summary ---');
  console.log(`Passed: ${results.length - failed.length}`);
  console.log(`Failed: ${failed.length}`);

  if (failed.length) {
    console.log('\nFailures:');
    for (const f of failed) console.log(`  ${f.label}: ${f.error || '0 bytes'}`);
    process.exit(1);
  }
}

main();
