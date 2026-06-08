import { FFmpeg } from '/vendor/@ffmpeg/ffmpeg/dist/esm/index.js';
import { fetchFile, toBlobURL } from '/vendor/@ffmpeg/util/dist/esm/index.js';
import {
  savePendingCheckout,
  loadPendingCheckout,
  clearPendingCheckout,
} from '/public/session-store.js';

/* ---------- state ---------- */
let conversionMode = 'local';
let fileStore = [];
let converted = false;
let selectedPlan = 'monthly';
let unlockTarget = null;
let activePreview = null;
let ffmpeg = null;
let ffmpegLoading = false;
let ffmpegReady = false;
let subscriptionActive = false;
let currentUser = null;

const PLANS = {
  monthly: { cta: 'Subscribe — $12/month' },
  annual: { cta: 'Subscribe — $72/year' },
};

const SVG_PLAY =
  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l14 8-14 8V4z"/></svg>';
const SVG_PAUSE =
  '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
const SVG_DL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M5 21h14"/></svg>';
const SVG_CHECK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>';

const drop = document.getElementById('drop');
const input = document.getElementById('fileInput');
const filesEl = document.getElementById('files');
const optsEl = document.querySelector('.opts');
let activePreset = 'music';

const PRESETS = {
  music: {
    bitrate: '320k',
    encodingMode: 'CBR',
    sampleRate: '44100',
    channels: 'Stereo',
    normalize: false,
    trim: false,
    fade: false,
    coverArt: true,
  },
  podcast: {
    bitrate: '96k',
    encodingMode: 'CBR',
    sampleRate: '44100',
    channels: 'Mono',
    normalize: true,
    trim: false,
    fade: false,
    coverArt: true,
  },
  audiobook: {
    bitrate: '64k',
    encodingMode: 'CBR',
    sampleRate: '22050',
    channels: 'Mono',
    normalize: true,
    trim: false,
    fade: false,
    coverArt: false,
  },
  ringtone: {
    bitrate: '192k',
    encodingMode: 'CBR',
    sampleRate: 'keep',
    channels: 'Stereo',
    normalize: false,
    trim: true,
    fade: true,
    coverArt: false,
  },
  web: {
    bitrate: '128k',
    encodingMode: 'VBR (V2)',
    sampleRate: '44100',
    channels: 'Stereo',
    normalize: false,
    trim: false,
    fade: false,
    coverArt: false,
  },
  archive: {
    bitrate: '256k',
    encodingMode: 'VBR (V0)',
    sampleRate: 'keep',
    channels: 'Stereo',
    normalize: false,
    trim: false,
    fade: false,
    coverArt: true,
  },
};

function selectChip(groupId, label) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.querySelectorAll('.chip').forEach((c) => {
    c.classList.toggle('on', c.textContent === label);
  });
}

function setSwitch(id, on) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('on', on);
}

function highlightPreset(id) {
  activePreset = id;
  document.querySelectorAll('#presets .preset').forEach((p) => {
    p.classList.toggle('on', p.dataset.preset === id);
  });
}

function clearPresetHighlight() {
  activePreset = null;
  document.querySelectorAll('#presets .preset').forEach((p) => p.classList.remove('on'));
}

window.applyPreset = function applyPreset(id) {
  const preset = PRESETS[id];
  if (!preset) return;

  selectChip('bitrate', preset.bitrate);
  selectChip('mode2', preset.encodingMode);
  selectChip('channels', preset.channels);
  document.getElementById('samplerate').value = preset.sampleRate;

  setSwitch('normalizeSwitch', preset.normalize);
  setSwitch('fadeSwitch', preset.fade);
  setSwitch('coverArtSwitch', preset.coverArt);

  const trimSwitch = document.getElementById('trimSwitch');
  setSwitch('trimSwitch', preset.trim);
  document.getElementById('trimRow').style.display = preset.trim ? 'flex' : 'none';
  if (!preset.trim) {
    document.getElementById('trimStart').value = '';
    document.getElementById('trimEnd').value = '';
  }

  highlightPreset(id);
  updateSummary();
};

/* ---------- chip groups ---------- */
document.querySelectorAll('.chips').forEach((group) => {
  group.addEventListener('click', (e) => {
    if (!e.target.classList.contains('chip')) return;
    group.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
    e.target.classList.add('on');
    clearPresetHighlight();
    updateSummary();
  });
});

document.getElementById('samplerate')?.addEventListener('change', () => {
  clearPresetHighlight();
  updateSummary();
});

document.getElementById('presets')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.preset');
  if (!btn?.dataset.preset) return;
  applyPreset(btn.dataset.preset);
});

document.querySelectorAll('.uc[data-preset]').forEach((card) => {
  card.addEventListener('click', () => {
    applyPreset(card.dataset.preset);
    setMode('local');
    document.getElementById('converter')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

['normalizeSwitch', 'fadeSwitch', 'coverArtSwitch', 'trimSwitch'].forEach((id) => {
  document.getElementById(id)?.addEventListener('click', () => {
    setTimeout(() => {
      clearPresetHighlight();
      updateSummary();
    }, 0);
  });
});

['trimStart', 'trimEnd', 'metaTitle', 'metaArtist'].forEach((id) => {
  document.getElementById(id)?.addEventListener('input', clearPresetHighlight);
});

/* ---------- mode toggle ---------- */
window.setMode = function setMode(mode) {
  conversionMode = mode;
  const seg = document.getElementById('seg');
  seg.querySelectorAll('button').forEach((b) =>
    b.classList.toggle('active', b.dataset.mode === mode)
  );
  seg.classList.toggle('server', mode === 'server');

  const note = document.getElementById('modeNote');
  const text = document.getElementById('modeText');
  const icon = note.querySelector('svg');

  if (mode === 'local') {
    icon.classList.add('local-only');
    text.classList.add('local-only');
    text.innerHTML =
      '<b>100% local.</b> Files are decoded right here in your tab. No upload, no server, no limits on what you can convert.';
    optsEl.style.display = '';
  } else {
    icon.classList.remove('local-only');
    text.classList.remove('local-only');
    text.innerHTML =
      '<b>Server-powered.</b> Big batches and multi-gigabyte sessions run on dedicated workers. Uploads are encrypted in transit and auto-deleted right after you download.';
    optsEl.style.display = 'none';
  }
  updateSummary();
};

window.toggleTrim = function toggleTrim(el) {
  el.classList.toggle('on');
  document.getElementById('trimRow').style.display = el.classList.contains('on')
    ? 'flex'
    : 'none';
};

/* ---------- drag & drop ---------- */
drop.addEventListener('click', () => input.click());
input.addEventListener('change', (e) => addFiles(e.target.files));
['dragenter', 'dragover'].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add('drag');
  })
);
['dragleave', 'drop'].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.remove('drag');
  })
);
drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

function fmtBytes(b) {
  if (b > 1e9) return (b / 1e9).toFixed(2) + ' GB';
  if (b > 1e6) return (b / 1e6).toFixed(1) + ' MB';
  if (b > 1e3) return (b / 1e3).toFixed(0) + ' KB';
  return b + ' B';
}

function fmtTime(s) {
  if (!isFinite(s) || s <= 0) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m + ':' + String(sec).padStart(2, '0');
}

function parseTimeInput(str) {
  if (!str || !str.trim()) return null;
  const parts = str.trim().split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function parseWav(file, cb) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const dv = new DataView(reader.result);
      const riff = String.fromCharCode(
        dv.getUint8(0),
        dv.getUint8(1),
        dv.getUint8(2),
        dv.getUint8(3)
      );
      if (riff !== 'RIFF') {
        cb(null);
        return;
      }
      const sampleRate = dv.getUint32(24, true);
      const byteRate = dv.getUint32(28, true);
      let off = 12;
      let dataSize = 0;
      while (off < dv.byteLength - 8) {
        const id = String.fromCharCode(
          dv.getUint8(off),
          dv.getUint8(off + 1),
          dv.getUint8(off + 2),
          dv.getUint8(off + 3)
        );
        const size = dv.getUint32(off + 4, true);
        if (id === 'data') {
          dataSize = size;
          break;
        }
        off += 8 + size + (size % 2);
      }
      if (!dataSize) dataSize = file.size - 44;
      const duration = byteRate ? dataSize / byteRate : 0;
      cb({ sampleRate, duration });
    } catch {
      cb(null);
    }
  };
  reader.onerror = () => cb(null);
  reader.readAsArrayBuffer(file.slice(0, 8192));
}

function currentBitrate() {
  const on = document.querySelector('#bitrate .chip.on');
  return on ? parseInt(on.textContent) : 256;
}

function getConversionOptions() {
  return {
    bitrate: currentBitrate(),
    encodingMode:
      document.querySelector('#mode2 .chip.on')?.textContent || 'CBR',
    sampleRate: document.getElementById('samplerate').value,
    channels:
      document.querySelector('#channels .chip.on')?.textContent || 'Stereo',
    normalize: document.getElementById('normalizeSwitch')?.classList.contains('on'),
    trim: document.getElementById('trimSwitch')?.classList.contains('on'),
    trimStart: parseTimeInput(document.getElementById('trimStart')?.value),
    trimEnd: parseTimeInput(document.getElementById('trimEnd')?.value),
    fade: document.getElementById('fadeSwitch')?.classList.contains('on'),
    title: document.getElementById('metaTitle')?.value?.trim() || '',
    artist: document.getElementById('metaArtist')?.value?.trim() || '',
    coverArt: document.getElementById('coverArtSwitch')?.classList.contains('on'),
  };
}

function scrollToConvertButton() {
  requestAnimationFrame(() => {
    document.getElementById('goBtn')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function addFiles(list) {
  const countBefore = fileStore.length;
  [...list].forEach((f) => {
    if (!/\.wave?$/i.test(f.name) && !/wav/i.test(f.type)) return;
    const item = {
      file: f,
      duration: 0,
      sampleRate: 0,
      url: null,
      blob: null,
      state: 'pending',
      unlocked: subscriptionActive,
      audio: null,
      outputName: f.name.replace(/\.wave?$/i, '') + '.mp3',
      outputSize: 0,
    };
    fileStore.push(item);
    parseWav(f, (info) => {
      if (info) {
        item.duration = info.duration;
        item.sampleRate = info.sampleRate;
      }
      renderFiles();
    });
  });
  converted = false;
  renderFiles();
  if (fileStore.length > countBefore) {
    scrollToConvertButton();
  }
}

window.removeFile = function removeFile(i) {
  if (activePreview?.i === i) stopPreview();
  else if (activePreview && activePreview.i > i) activePreview.i--;

  const item = fileStore[i];
  if (item?.url) URL.revokeObjectURL(item.url);
  if (item?.audio) {
    item.audio.pause();
    item.audio = null;
  }
  fileStore.splice(i, 1);

  if (fileStore.length === 0 || !fileStore.some((f) => f.state === 'converted')) {
    converted = false;
  }
  renderFiles();
};

function buildWave(seed) {
  let s = 7;
  for (let k = 0; k < seed.length; k++) s += seed.charCodeAt(k) * (k + 3);
  let out = '';
  const N = 44;
  for (let i = 0; i < N; i++) {
    s = (s * 9301 + 49297) % 233280;
    const h = 20 + Math.round((s / 233280) * 78);
    out += '<span style="height:' + h + '%"></span>';
  }
  return out;
}

function renderFiles() {
  const br = currentBitrate();
  const mode2 = document.querySelector('#mode2 .chip.on')?.textContent || 'CBR';
  const ch = document.querySelector('#channels .chip.on')?.textContent || 'Stereo';
  filesEl.innerHTML = '';

  fileStore.forEach((item, i) => {
    const estBytes = item.outputSize || (item.duration ? (br * 1000 / 8) * item.duration : 0);

    if (item.state !== 'converted') {
      const row = document.createElement('div');
      row.className = 'file';
      row.innerHTML = `
        <div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="20" cy="16" r="3"/></svg></div>
        <div class="meta">
          <div class="nm">${item.file.name}</div>
          <div class="stats">${fmtBytes(item.file.size)} WAV <span class="arrow">→</span> MP3 · ${fmtTime(item.duration)}${item.sampleRate ? ' · ' + (item.sampleRate / 1000).toFixed(1) + 'kHz' : ''}</div>
        </div>
        <div class="est">${estBytes ? '≈ ' + fmtBytes(estBytes) : '—'}<small>at ${br}k</small></div>
        <button class="rm" data-rm="${i}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>`;
      row.querySelector('[data-rm]').addEventListener('click', () => removeFile(i));
      filesEl.appendChild(row);
    } else {
      const base = item.outputName.replace(/\.mp3$/i, '');
      const cap = item.unlocked
        ? item.duration || 0
        : Math.min(30, item.duration || 30);
      const previewLabel = item.unlocked
        ? 'Full preview'
        : 'Preview — first 30 seconds (free)';
      const card = document.createElement('div');
      card.className = 'result-card' + (item.unlocked ? ' unlocked' : '');
      card.dataset.i = i;
      const lockSvg =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>';

      const statsLabel =
        conversionMode === 'server'
          ? `Server · ${item.outputSize ? fmtBytes(item.outputSize) : '—'}`
          : `${br}k ${mode2} · ${ch} · ${estBytes ? '≈ ' + fmtBytes(estBytes) : '—'}`;

      card.innerHTML = `
        <div class="rc-top">
          <div class="rc-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="20" cy="16" r="3"/></svg></div>
          <div class="rc-meta">
            <div class="nm">${item.outputName} <span class="ready">READY</span></div>
            <div class="stats">${statsLabel}</div>
          </div>
          ${
            item.unlocked
              ? '<span class="lock-chip" style="color:var(--mint);border-color:var(--line-strong)">' +
                SVG_CHECK +
                ' Unlocked</span>'
              : '<span class="lock-chip">' + lockSvg + ' Locked</span>'
          }
        </div>
        <div class="preview-label"><span>${previewLabel}</span><span class="bar"></span></div>
        <div class="preview">
          <button class="play-btn" data-play="${i}">${SVG_PLAY}</button>
          <div class="wave">${buildWave(item.file.name)}</div>
          <div class="ptime">0:00 / ${fmtTime(cap)}</div>
        </div>
        <div class="rc-actions">
          ${
            item.unlocked
              ? `<a class="dl-unlocked" href="${item.url}" download="${item.outputName}">${SVG_DL} Download MP3</a>
                 <button class="btn-clear" data-clear="${i}">Clear from list</button>`
              : `<button class="btn-unlock" data-unlock="${i}">${lockSvg} Unlock conversions</button>
                 <button class="dl-locked" data-unlock="${i}">${lockSvg} Unlock</button>
                 <button class="btn-clear subtle" data-clear="${i}">Remove</button>`
          }
        </div>`;

      card.querySelector('[data-play]')?.addEventListener('click', () => togglePreview(i));
      card.querySelectorAll('[data-unlock]').forEach((btn) =>
        btn.addEventListener('click', () => openUnlockModal(i))
      );
      card.querySelectorAll('[data-clear]').forEach((btn) =>
        btn.addEventListener('click', () => removeFile(i))
      );
      filesEl.appendChild(card);
    }
  });
  updateSummary();
}

function updateSummary() {
  renderEstimatesOnly();
  const sum = document.getElementById('summary');
  if (fileStore.length === 0) {
    converted = false;
    sum.innerHTML = '<b>No files yet</b> — drop a WAV above to get started.';
    refreshActionButton();
    return;
  }

  const br = currentBitrate();
  const mode2 = document.querySelector('#mode2 .chip.on')?.textContent || 'CBR';
  const ch = document.querySelector('#channels .chip.on')?.textContent || 'Stereo';

  if (converted) {
    const locked = fileStore.filter((f) => !f.unlocked).length;
    sum.innerHTML =
      locked > 0
        ? `<b>${fileStore.length} file${fileStore.length > 1 ? 's' : ''} converted.</b> Preview free · <b>unlock unlimited conversions</b> to export.`
        : `<b>All unlocked.</b> Convert and export as much as you need.`;
  } else if (conversionMode === 'server') {
    const totalIn = fileStore.reduce((a, f) => a + f.file.size, 0);
    sum.innerHTML = `<b>${fileStore.length} file${fileStore.length > 1 ? 's' : ''}</b> · server mode · ${fmtBytes(totalIn)} → MP3`;
  } else {
    const totalIn = fileStore.reduce((a, f) => a + f.file.size, 0);
    const totalDur = fileStore.reduce((a, f) => a + (f.duration || 0), 0);
    const totalOut = (br * 1000 / 8) * totalDur;
    const saved =
      totalIn > totalOut && totalOut ? Math.round((1 - totalOut / totalIn) * 100) : 0;
    sum.innerHTML = `<b>${fileStore.length} file${fileStore.length > 1 ? 's' : ''}</b> · ${br}k ${mode2} · ${ch} · ${fmtBytes(totalIn)} → ${totalOut ? '≈ ' + fmtBytes(totalOut) : '—'}${saved ? ' · save ~' + saved + '%' : ''}`;
  }
  refreshActionButton();
}

function renderEstimatesOnly() {
  const br = currentBitrate();
  document.querySelectorAll('.file').forEach((row, i) => {
    const item = fileStore[i];
    if (!item || item.state === 'converted') return;
    const estBytes = item.duration ? (br * 1000 / 8) * item.duration : 0;
    const est = row.querySelector('.est');
    if (est)
      est.innerHTML = `${estBytes ? '≈ ' + fmtBytes(estBytes) : '—'}<small>at ${br}k</small>`;
  });
}

/* ---------- FFmpeg WASM ---------- */
async function loadFfmpeg(onProgress) {
  if (ffmpegReady) return ffmpeg;
  if (ffmpegLoading) {
    while (ffmpegLoading) await new Promise((r) => setTimeout(r, 200));
    return ffmpeg;
  }
  ffmpegLoading = true;

  ffmpeg = new FFmpeg();
  ffmpeg.on('log', ({ message }) => console.debug('[ffmpeg]', message));
  ffmpeg.on('progress', ({ progress }) => {
    if (onProgress) onProgress(Math.min(99, Math.round(progress * 100)));
  });

  const origin = window.location.origin;
  const coreBase = `${origin}/vendor/@ffmpeg/core/dist/esm`;
  const workerURL = `${origin}/vendor/@ffmpeg/ffmpeg/dist/esm/worker.js`;

  await ffmpeg.load({
    classWorkerURL: workerURL,
    coreURL: await toBlobURL(`${coreBase}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${coreBase}/ffmpeg-core.wasm`, 'application/wasm'),
  });

  ffmpegReady = true;
  ffmpegLoading = false;
  return ffmpeg;
}

function buildFfmpegArgs(opts, duration) {
  const args = ['-i', 'input.wav'];

  if (opts.trim && opts.trimStart != null) args.push('-ss', String(opts.trimStart));
  if (opts.trim && opts.trimEnd != null) args.push('-to', String(opts.trimEnd));

  const filters = [];
  if (opts.normalize) {
    filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  }
  if (opts.fade) {
    const dur = duration || 0;
    const fadeOut = Math.max(0, dur - 2);
    filters.push('afade=t=in:st=0:d=2', `afade=t=out:st=${fadeOut}:d=2`);
  }
  if (filters.length) args.push('-af', filters.join(','));

  if (opts.sampleRate && opts.sampleRate !== 'keep') {
    args.push('-ar', opts.sampleRate);
  }

  if (opts.channels === 'Mono') args.push('-ac', '1');
  else args.push('-ac', '2');

  args.push('-codec:a', 'libmp3lame');

  const mode = opts.encodingMode;
  if (mode === 'CBR') {
    args.push('-b:a', `${opts.bitrate}k`);
  } else if (mode === 'VBR (V0)') {
    args.push('-q:a', '0');
  } else if (mode === 'VBR (V2)') {
    args.push('-q:a', '2');
  } else if (mode === 'ABR') {
    args.push('-abr', `${opts.bitrate}k`);
  }

  if (opts.title) args.push('-metadata', `title=${opts.title}`);
  if (opts.artist) args.push('-metadata', `artist=${opts.artist}`);

  args.push('-y', 'output.mp3');
  return args;
}

async function convertLocal(item, opts, onProgress) {
  const ff = await loadFfmpeg(onProgress);
  const inputName = 'input.wav';
  const data = await fetchFile(item.file);
  await ff.writeFile(inputName, data);

  const args = buildFfmpegArgs(opts, item.duration);
  await ff.exec(args);

  const output = await ff.readFile('output.mp3');
  await ff.deleteFile(inputName);
  await ff.deleteFile('output.mp3');

  const blob = new Blob([output.buffer], { type: 'audio/mpeg' });
  return blob;
}

/* ---------- Zamzar server conversion ---------- */
async function convertServer(item, onProgress) {
  onProgress(5);
  const form = new FormData();
  form.append('file', item.file, item.file.name);

  const startRes = await fetch('/api/convert/server', { method: 'POST', body: form });
  if (!startRes.ok) {
    const err = await startRes.json().catch(() => ({}));
    throw new Error(err.error || 'Server conversion failed to start');
  }
  const { jobId } = await startRes.json();
  onProgress(15);

  let fileId = null;
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    const statusRes = await fetch(`/api/convert/status/${jobId}`);
    if (!statusRes.ok) throw new Error('Failed to check conversion status');
    const status = await statusRes.json();

    if (status.status === 'successful') {
      fileId = status.fileId;
      break;
    }
    if (status.status === 'failed') {
      throw new Error(status.error || 'Server conversion failed');
    }
    onProgress(Math.min(85, 15 + attempt * 2));
  }

  if (!fileId) throw new Error('Conversion timed out');

  onProgress(90);
  const dlRes = await fetch(`/api/convert/download/${fileId}`);
  if (!dlRes.ok) throw new Error('Failed to download converted file');
  const blob = await dlRes.blob();
  onProgress(100);
  return blob;
}

function setItemConverted(item, blob) {
  if (item.url) URL.revokeObjectURL(item.url);
  item.blob = blob;
  item.url = URL.createObjectURL(blob);
  item.outputSize = blob.size;
  item.state = 'converted';
  item.unlocked = subscriptionActive;
  if (item.audio) {
    item.audio.pause();
    item.audio = null;
  }
}

async function saveConversionToLibrary(item, mode) {
  if (!currentUser || !subscriptionActive || !item.blob || item.libraryId) return;

  try {
    const form = new FormData();
    form.append('file', item.blob, item.outputName);
    form.append('mode', mode);
    form.append('originalName', item.file?.name || item.outputName.replace(/\.mp3$/i, '.wav'));
    form.append('outputName', item.outputName);
    form.append('duration', String(item.duration || 0));

    const res = await fetch('/api/files', {
      method: 'POST',
      body: form,
      credentials: 'include',
    });

    if (res.ok) {
      const data = await res.json();
      item.libraryId = data.id;
    }
  } catch (err) {
    console.warn('Could not save to library:', err);
  }
}

async function saveAllToLibrary() {
  const tasks = fileStore
    .filter((it) => it.state === 'converted' && it.blob && !it.libraryId)
    .map((it) => saveConversionToLibrary(it, conversionMode));
  await Promise.all(tasks);
}

/* ---------- convert ---------- */
window.convert = async function convert() {
  if (fileStore.length === 0 || converted) return;

  const prog = document.getElementById('prog');
  const bar = document.getElementById('progBar');
  const go = document.getElementById('goBtn');
  const summary = document.getElementById('summary');

  prog.classList.add('show');
  go.disabled = true;
  bar.style.width = '0';
  stopPreview();

  const opts = getConversionOptions();
  const pending = fileStore.filter((f) => f.state !== 'converted');

  try {
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      const fileProgress = (pct) => {
        const overall = ((i + pct / 100) / pending.length) * 100;
        bar.style.width = overall + '%';
      };

      summary.innerHTML = `<b>Converting ${i + 1} of ${pending.length}…</b> ${item.file.name}`;

      let blob;
      if (conversionMode === 'local') {
        blob = await convertLocal(item, opts, fileProgress);
      } else {
        blob = await convertServer(item, fileProgress);
      }
      setItemConverted(item, blob);
      await saveConversionToLibrary(item, conversionMode);
    }

    bar.style.width = '100%';
    converted = true;
    renderFiles();
    requestAnimationFrame(() => {
      const preview = document.querySelector('.result-card .preview');
      preview?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  } catch (err) {
    console.error('Conversion error:', err);
    summary.innerHTML = `<b>Conversion failed:</b> ${err.message}`;
  } finally {
    setTimeout(() => prog.classList.remove('show'), 400);
    refreshActionButton();
  }
};

/* ---------- preview player ---------- */
function setPlayIcon(card, playing) {
  const btn = card.querySelector('.play-btn');
  if (!btn) return;
  btn.classList.toggle('playing', playing);
  btn.innerHTML = playing ? SVG_PAUSE : SVG_PLAY;
}

function updateWave(card, prog, cap, t) {
  const bars = card.querySelectorAll('.wave span');
  const n = bars.length;
  const active = Math.floor(prog * n);
  bars.forEach((b, idx) => {
    b.classList.toggle('played', idx < active);
    b.classList.toggle('cursor', idx === active);
  });
  const pt = card.querySelector('.ptime');
  if (pt) pt.textContent = fmtTime(t) + ' / ' + fmtTime(cap);
}

function stopPreview() {
  if (!activePreview) return;
  activePreview.audio.pause();
  activePreview.audio.currentTime = 0;
  setPlayIcon(activePreview.card, false);
  updateWave(activePreview.card, 0, activePreview.cap, 0);
  activePreview = null;
}

window.togglePreview = function togglePreview(i) {
  const item = fileStore[i];
  const card = document.querySelector('.result-card[data-i="' + i + '"]');
  if (!item?.url || !card) return;

  const cap = item.unlocked
    ? item.duration || 999999
    : Math.min(30, item.duration || 30);

  if (activePreview?.i === i && !activePreview.audio.paused) {
    activePreview.audio.pause();
    setPlayIcon(card, false);
    return;
  }

  stopPreview();
  if (!item.audio) {
    item.audio = new Audio(item.url);
  }
  const audio = item.audio;
  activePreview = { audio, i, card, cap };

  audio.currentTime = 0;
  audio.play().catch(() => {});
  setPlayIcon(card, true);

  audio.ontimeupdate = () => {
    const limit = item.unlocked ? item.duration || audio.duration : cap;
    if (!item.unlocked && audio.currentTime >= cap) {
      audio.pause();
      audio.currentTime = 0;
      setPlayIcon(card, false);
      updateWave(card, 0, cap, 0);
      return;
    }
    const denom = limit || cap || 1;
    updateWave(card, audio.currentTime / denom, denom, audio.currentTime);
  };
  audio.onpause = () => setPlayIcon(card, false);
  audio.onended = () => {
    setPlayIcon(card, false);
    updateWave(card, 0, cap, 0);
  };
};

/* ---------- action button ---------- */
function refreshActionButton() {
  const go = document.getElementById('goBtn');
  if (!go) return;

  if (!converted) {
    go.disabled = fileStore.length === 0;
    go.onclick = convert;
    go.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 3l14 9-14 9V3z"/></svg> Convert';
    return;
  }

  const locked = fileStore.filter((f) => !f.unlocked).length;
  if (locked > 0) {
    go.disabled = false;
    go.onclick = () => openUnlockModal('all');
    go.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg> Unlock unlimited conversions';
  } else {
    go.disabled = false;
    go.onclick = downloadAll;
    go.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M5 21h14"/></svg> Download all';
  }
}

window.downloadAll = function downloadAll() {
  fileStore.forEach((it) => {
    if (!it.url || !it.unlocked) return;
    const a = document.createElement('a');
    a.href = it.url;
    a.download = it.outputName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
};

/* ---------- subscription / unlock ---------- */
function isSubscribed() {
  return subscriptionActive;
}

function unlockAll() {
  subscriptionActive = true;
  fileStore.forEach((it) => {
    it.unlocked = true;
  });
  renderFiles();
  updateNavAuth();
  saveAllToLibrary();
}

async function fetchAuthState() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function updateNavAuth() {
  const link = document.getElementById('navAccount');
  const filesLink = document.getElementById('navFiles');
  if (!link) return;

  fetchAuthState().then((data) => {
    currentUser = data?.user || null;
    if (data?.user) {
      link.textContent = 'Account';
      link.href = '/account.html';
      if (filesLink) filesLink.hidden = false;
    } else {
      link.textContent = 'Log in';
      link.href = '/login.html';
      if (filesLink) filesLink.hidden = true;
    }
  });
}

function unlockIndices() {
  return fileStore.map((_, i) => i).filter((i) => !fileStore[i].unlocked);
}

window.selectPlan = function selectPlan(plan) {
  selectedPlan = plan;
  document.querySelectorAll('#plans .plan').forEach((p) =>
    p.classList.toggle('selected', p.dataset.plan === plan)
  );
  document.getElementById('payLabel').textContent = PLANS[plan].cta;
};

window.openUnlockModal = function openUnlockModal(target) {
  unlockTarget = target;
  if (unlockIndices().length === 0) return;

  const lockedCount = unlockIndices().length;
  document.getElementById('modalSub').innerHTML =
    `You've heard the <b>30-second preview</b>. Go Pro to unlock <b>unlimited conversions</b>${lockedCount > 1 ? ' for all your files' : ''} — full-length exports, every option, local or server.`;
  document.getElementById('getBox').innerHTML = `
    <div class="gi">${SVG_CHECK} Unlimited conversions — local &amp; server</div>
    <div class="gi">${SVG_CHECK} Full-length exports — no 30-second cap</div>
    <div class="gi">${SVG_CHECK} Every bitrate, VBR &amp; processing option</div>
    <div class="gi">${SVG_CHECK} Batch convert with no watermark</div>`;
  selectPlan(selectedPlan);
  document.getElementById('redirecting').classList.remove('show');
  document.getElementById('overlay').classList.add('show');
};

window.closeModal = function closeModal() {
  document.getElementById('overlay').classList.remove('show');
};

function scrollToPreview() {
  requestAnimationFrame(() => {
    const preview = document.querySelector('.result-card .preview');
    preview?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

async function restorePendingSession() {
  const saved = await loadPendingCheckout();
  if (!saved?.items?.length) return false;

  fileStore.forEach((item) => {
    if (item.url) URL.revokeObjectURL(item.url);
  });

  fileStore = saved.items.map((item) => {
    const url = URL.createObjectURL(item.blob);
    return {
      file: { name: item.originalName, size: item.outputSize || 0 },
      duration: item.duration,
      sampleRate: item.sampleRate,
      url,
      blob: item.blob,
      state: 'converted',
      unlocked: subscriptionActive,
      audio: null,
      outputName: item.outputName,
      outputSize: item.outputSize,
    };
  });

  converted = true;
  if (saved.conversionMode) conversionMode = saved.conversionMode;

  await clearPendingCheckout();
  renderFiles();
  return true;
}

window.goToStripeCheckout = async function goToStripeCheckout() {
  const redirecting = document.getElementById('redirecting');
  redirecting.classList.add('show');

  try {
    if (converted) {
      await savePendingCheckout({ conversionMode, items: fileStore });
    }

    const res = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: selectedPlan }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Checkout unavailable');
    }

    const { url } = await res.json();
    if (url) {
      window.location.href = url;
      return;
    }
    throw new Error('No checkout URL returned');
  } catch (err) {
    console.error('Checkout error:', err);
    redirecting.classList.remove('show');
    alert(
      err.message +
        '\n\nIf Stripe is not configured yet, set STRIPE_SECRET_KEY and price IDs in your .env file.'
    );
  }
};

async function checkSubscriptionOnLoad() {
  const data = await fetchAuthState();
  if (!data) {
    currentUser = null;
    return;
  }

  currentUser = data.user || null;
  subscriptionActive = !!data.subscriptionActive;
  if (subscriptionActive) {
    fileStore.forEach((it) => {
      it.unlocked = true;
    });
    if (converted) renderFiles();
    saveAllToLibrary();
  }
  updateNavAuth();
}

async function handlePostAuthReturn() {
  const params = new URLSearchParams(window.location.search);
  const welcome = params.get('welcome') === '1';
  const restore = params.get('restore') === '1';

  if (!welcome && !restore) return false;

  if (welcome) subscriptionActive = true;

  const restored = await restorePendingSession();
  unlockAll();

  if (restored) {
    scrollToPreview();
  }

  window.history.replaceState({}, '', window.location.pathname + '#converter');
  return restored;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

/* ---------- init ---------- */
async function handleCancelledCheckout() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('checkout') !== 'cancelled') return false;

  const restored = await restorePendingSession();
  if (restored) scrollToPreview();

  window.history.replaceState({}, '', window.location.pathname + '#converter');
  return restored;
}

async function init() {
  applyPreset('music');
  await checkSubscriptionOnLoad();
  await handleCancelledCheckout();

  const welcomed = await handlePostAuthReturn();

  if (!welcomed && subscriptionActive) {
    const restored = await restorePendingSession();
    if (restored) {
      unlockAll();
      scrollToPreview();
    }
  }

  updateNavAuth();
}

init();
