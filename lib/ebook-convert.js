import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const EBOOK_CONVERT_BIN = process.env.CALIBRE_EBOOK_CONVERT || 'ebook-convert';
const CONVERSION_TIMEOUT_MS = 10 * 60 * 1000;

const PROFILE_MAP = {
  kindle: 'kindle',
  kobo: 'kobo',
  ipad: 'ipad',
  generic: 'tablet',
};

const TEXT_SIZE_MAP = {
  small: 10,
  default: 12,
  large: 14,
  xlarge: 18,
};

function sanitizeFilename(name) {
  const base = path.basename(name || 'document.pdf');
  return base.replace(/[^\w.\-()+ ]/g, '_') || 'document.pdf';
}

export function buildCalibreArgs(options = {}) {
  const args = [];

  const profile = PROFILE_MAP[options.profile] || PROFILE_MAP.generic;
  args.push(`--output-profile=${profile}`);

  const fontSize = TEXT_SIZE_MAP[options.textSize] || TEXT_SIZE_MAP.default;
  args.push(`--base-font-size=${fontSize}`);

  if (options.layout === 'preserve') {
    args.push('--disable-font-rescaling');
  }

  if (options.chapters === 'headings') {
    args.push('--level1-toc=//h:h1');
    args.push('--chapter=/');
  } else if (options.chapters === 'pages') {
    args.push('--page-breaks-before=/');
  }

  if (options.heuristics) {
    args.push('--enable-heuristics');
  }

  if (options.embedFonts) {
    args.push('--embed-all-fonts');
  }

  if (options.removePageNumbers) {
    args.push('--remove-page-numbers');
  }

  if (options.blankLineParagraphs) {
    args.push('--insert-blank-line');
  }

  const title = typeof options.title === 'string' ? options.title.trim() : '';
  const author = typeof options.author === 'string' ? options.author.trim() : '';
  if (title) args.push(`--title=${title}`);
  if (author) args.push(`--authors=${author}`);

  return args;
}

function runEbookConvert(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(EBOOK_CONVERT_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('Conversion timed out after 10 minutes'));
    }, CONVERSION_TIMEOUT_MS);

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new Error('Calibre ebook-convert is not installed on this server'));
      } else {
        reject(err);
      }
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      const message = stderr.trim() || `ebook-convert exited with code ${code}`;
      reject(new Error(message.slice(-2000)));
    });
  });
}

export async function convertPdfToEpub(inputBuffer, originalName, options = {}) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yc-ebook-'));
  const inputPath = path.join(tmpDir, sanitizeFilename(originalName));
  const outputPath = path.join(tmpDir, 'output.epub');

  try {
    await fs.writeFile(inputPath, inputBuffer);
    const calibreArgs = buildCalibreArgs(options);
    await runEbookConvert([inputPath, outputPath, ...calibreArgs]);
    return fs.readFile(outputPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
