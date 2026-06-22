import { FFmpeg } from '/vendor/@ffmpeg/ffmpeg/dist/esm/index.js';
import { fetchFile, toBlobURL } from '/vendor/@ffmpeg/util/dist/esm/index.js';
import {
  savePendingCheckout,
  loadPendingCheckout,
  clearPendingCheckout,
  loadPendingFiles,
  clearPendingFiles,
  savePendingFiles,
} from '/public/session-store.js';
import {
  getInputFormat,
  getRoute,
  INPUT_DETECTORS,
  findRoute,
  assignInputFormat,
  ALL_INPUT_ACCEPT,
} from '/public/conversion-formats.js';
import { modalTestimonialsHtml } from '/public/testimonials.js';
import { trackFunnelEvent } from '/public/funnel-events.js';

const inputSlug = document.documentElement.dataset.inputFormat || 'wav';
const outputSlug = document.documentElement.dataset.outputFormat || 'mp3';
const inputFormat = getInputFormat(inputSlug);
const outputFormat = getRoute(inputSlug, outputSlug);

/* ---------- state ---------- */
let conversionMode = null;
let fileStore = [];
let converted = false;
let selectedPlan = 'unlock';

const UNLOCK_PRICE_LINE = '$9.99 · unlimited conversions';
let unlockTarget = null;
let activePreview = null;
let ffmpeg = null;
let ffmpegLoading = false;
let ffmpegReady = false;
let subscriptionActive = false;
let currentUser = null;
let freeTier = {
  unlimited: false,
  limit: 2,
  used: 0,
  remaining: 2,
  resetsAt: null,
};

function freeTierExhausted() {
  return !subscriptionActive && !freeTier.unlimited && freeTier.remaining <= 0;
}

function freeTierHintHtml() {
  if (subscriptionActive || freeTier.unlimited) return '';
  if (freeTier.remaining <= 0) {
    return ` · <span class="free-tier-hint exhausted">Daily free limit reached — preview-only until tomorrow</span>`;
  }
  return '';
}

async function refreshFreeTier() {
  try {
    const res = await fetch('/api/free-tier', { credentials: 'include' });
    if (res.ok) {
      freeTier = await res.json();
      dispatchFreeTierUpdate();
    }
  } catch {
    // best-effort
  }
}

function dispatchFreeTierUpdate() {
  document.dispatchEvent(
    new CustomEvent('free-tier-update', {
      detail: { freeTier, subscriptionActive, selectedPlan },
    })
  );
}

window.hasLockedConversions = function hasLockedConversions() {
  return fileStore.some((f) => f.state === 'converted' && !f.unlocked);
};

async function consumeFreeTierSlot() {
  if (subscriptionActive || freeTier.unlimited) return true;
  try {
    const res = await fetch('/api/free-tier/consume', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 1 }),
    });
    const data = await res.json();
    if (data.limit != null) {
      freeTier = {
        unlimited: !!data.unlimited,
        limit: data.limit,
        used: data.used,
        remaining: data.remaining,
        resetsAt: data.resetsAt,
      };
      dispatchFreeTierUpdate();
    }
    return res.ok && data.consumed > 0;
  } catch {
    return false;
  }
}

async function finalizeItemUnlock(item) {
  if (subscriptionActive) {
    item.unlocked = true;
    return;
  }
  item.unlocked = await consumeFreeTierSlot();
}

const PREVIEW_DOWNLOAD_SECONDS = 10;
const PREVIEW_PLAY_SECONDS = 30;

const PLANS = {
  unlock: { cta: 'Unlock Now', priceLine: UNLOCK_PRICE_LINE },
};

function updateUnlockPriceLabels() {
  const line = PLANS.unlock.priceLine;
  const heroPrice = document.getElementById('modalUrgencyPrice');
  if (heroPrice) heroPrice.textContent = line;
}

const SVG_PREVIEW_HEAD =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="20" cy="16" r="3"/></svg>';
const SVG_DOWNLOAD_HEAD =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M5 21h14"/></svg>';
const SVG_DONE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>';
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
if (input) input.accept = ALL_INPUT_ACCEPT;
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
function revealUploadStep() {
  const step = document.getElementById('uploadStep');
  if (!step || step.classList.contains('ready')) return;
  step.classList.add('ready');
  if (fileStore.length > 0) scrollToConvertButton();
}

window.setMode = function setMode(mode) {
  conversionMode = mode;
  const seg = document.getElementById('seg');
  seg.querySelectorAll('button').forEach((b) =>
    b.classList.toggle('active', b.dataset.mode === mode)
  );
  seg.classList.toggle('server', mode === 'server');
  seg.classList.add('chosen');

  const note = document.getElementById('modeNote');
  const text = document.getElementById('modeText');
  const icon = note.querySelector('svg');

  if (mode === 'local') {
    icon.classList.add('local-only');
    text.classList.add('local-only');
    text.innerHTML =
      '<b>100% local.</b> Files are decoded right here in your tab. No upload, no server, no limits on what you can convert. All files are converted in the browser and do not leave your device.';
    optsEl.style.display = '';
  } else {
    icon.classList.remove('local-only');
    text.classList.remove('local-only');
    text.innerHTML =
      '<b>Server-powered.</b> Big batches and multi-gigabyte sessions run on dedicated workers. Uploads are encrypted in transit and auto-deleted right after you download.';
    optsEl.style.display = 'none';
  }
  revealUploadStep();
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
input.addEventListener('change', (e) => {
  processDroppedFiles(e.target.files);
  e.target.value = '';
});
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
drop.addEventListener('drop', (e) => {
  e.stopPropagation();
  processDroppedFiles(e.dataTransfer.files);
});

const converterEl = document.getElementById('converter');
if (converterEl) {
  ['dragenter', 'dragover'].forEach((ev) => {
    converterEl.addEventListener(ev, (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      drop?.classList.add('drag');
    });
  });
  converterEl.addEventListener('dragleave', (e) => {
    if (converterEl.contains(e.relatedTarget)) return;
    drop?.classList.remove('drag');
  });
  converterEl.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    drop?.classList.remove('drag');
    processDroppedFiles(e.dataTransfer.files);
  });
}

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

function parseMediaDuration(file, cb) {
  const audio = new Audio();
  const url = URL.createObjectURL(file);
  audio.addEventListener('loadedmetadata', () => {
    cb({ sampleRate: 0, duration: audio.duration || 0 });
    URL.revokeObjectURL(url);
  });
  audio.addEventListener('error', () => {
    cb(null);
    URL.revokeObjectURL(url);
  });
  audio.src = url;
}

function parseInputFile(file, cb) {
  if (inputFormat.slug === 'wav') return parseWav(file, cb);
  return parseMediaDuration(file, cb);
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

function scrollToConvertButtonAfterLayout() {
  setTimeout(scrollToConvertButton, 400);
}

let formatRedirectPending = null;

function bucketFilesByInput(files) {
  const map = new Map();
  for (const file of files) {
    const fmt = assignInputFormat(file);
    if (!fmt) continue;
    if (!map.has(fmt.slug)) map.set(fmt.slug, { fmt, files: [] });
    map.get(fmt.slug).files.push(file);
  }
  return [...map.values()];
}

function pushFileToStore(f) {
  const item = {
    file: f,
    duration: 0,
    sampleRate: 0,
    url: null,
    blob: null,
    state: 'pending',
    unlocked: subscriptionActive,
    audio: null,
    outputName: inputFormat.stripExt(f.name) + '.' + outputFormat.ext,
    outputSize: 0,
    downloaded: false,
  };
  fileStore.push(item);
  parseInputFile(f, (info) => {
    if (info) {
      item.duration = info.duration;
      item.sampleRate = info.sampleRate;
    }
    renderFiles();
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showFormatNoticeModal(html, { showGo = false, title = 'Different format detected' } = {}) {
  formatRedirectPending = null;
  const titleEl = document.getElementById('formatModalTitle');
  if (titleEl) titleEl.textContent = title;
  document.getElementById('formatModalSub').innerHTML = html;
  document.getElementById('formatModalGo').hidden = !showGo;
  document.getElementById('formatOverlay').classList.add('show');
}

function showFormatRedirectModal({ files, detectedFmt, route }) {
  document.getElementById('formatModalTitle').textContent = 'Different format detected';
  formatRedirectPending = { files, detectedFmt, route };
  const count = files.length;
  const fileWord = count === 1 ? 'file' : 'files';
  document.getElementById('formatModalSub').innerHTML =
    `This looks like <b>${detectedFmt.label}</b> — ${count} ${fileWord} on a page for <b>${inputFormat.label} to ${outputFormat.label}</b>. Switch to the matching converter and take your files with you?`;
  const goBtn = document.getElementById('formatModalGo');
  goBtn.hidden = false;
  goBtn.disabled = false;
  goBtn.textContent = `Go to ${detectedFmt.label} → ${outputFormat.label}`;
  document.getElementById('formatOverlay').classList.add('show');
}

window.closeFormatModal = function closeFormatModal() {
  document.getElementById('formatOverlay').classList.remove('show');
  formatRedirectPending = null;
  const goBtn = document.getElementById('formatModalGo');
  if (goBtn) {
    goBtn.hidden = false;
    goBtn.disabled = false;
  }
};

window.goToFormatRedirect = async function goToFormatRedirect() {
  if (!formatRedirectPending) return;
  const { files, detectedFmt, route } = formatRedirectPending;
  const goBtn = document.getElementById('formatModalGo');
  goBtn.disabled = true;
  goBtn.textContent = 'Saving files…';
  try {
    await savePendingFiles(files, detectedFmt.slug, { outputSlug });
    window.location.href = route.path;
  } catch (err) {
    console.error('Could not stage files for redirect:', err);
    goBtn.disabled = false;
    goBtn.textContent = `Go to ${detectedFmt.label} → ${outputFormat.label}`;
    document.getElementById('formatModalSub').innerHTML =
      '<b>Could not save files.</b> Try again, or open the converter and upload there manually.';
  }
};

function isRecognizedAudioFile(file) {
  return assignInputFormat(file) !== null;
}

function showUnsupportedModal(files) {
  const fileRef =
    files.length === 1
      ? `<b>${escapeHtml(files[0].name)}</b>`
      : `<b>${files.length} files</b>`;
  showFormatNoticeModal(
    `Unfortunately this file type isn't presently supported. ${fileRef} couldn't be added.<p class="modal-supported">We support WAV, MP3, M4A, MP4, AAC, OGG, and WMA.</p>`,
    { title: 'Unsupported file type' }
  );
}

async function redirectToMatchingConverter({ files, detectedFmt, route }) {
  const sum = document.getElementById('summary');
  if (sum) {
    sum.innerHTML = `<b>Switching to ${detectedFmt.label} → ${outputFormat.label}…</b> Your files are coming with you.`;
  }
  try {
    await savePendingFiles(files, detectedFmt.slug, { outputSlug });
    window.location.href = route.path;
  } catch (err) {
    console.error('Could not stage files for redirect:', err);
    showFormatRedirectModal({ files, detectedFmt, route });
  }
}

async function handleMismatchedFiles(otherFiles) {
  if (!otherFiles.length) return;

  const unknown = otherFiles.filter((f) => !isRecognizedAudioFile(f));
  const recognized = otherFiles.filter((f) => isRecognizedAudioFile(f));

  if (unknown.length > 0) {
    showUnsupportedModal(unknown);
    return;
  }

  const buckets = bucketFilesByInput(recognized);

  if (buckets.length > 1) {
    showFormatNoticeModal(
      '<b>Mixed formats detected.</b> Please drop only one format at a time, or use a converter that matches your files.'
    );
    return;
  }

  const { fmt: detectedFmt, files } = buckets[0];
  if (detectedFmt.slug === inputSlug) return;

  const route = findRoute(detectedFmt.slug, outputSlug);
  if (!route) {
    showFormatNoticeModal(
      `This looks like <b>${detectedFmt.label}</b>, but we don't have a <b>${detectedFmt.label} to ${outputFormat.label}</b> converter. <a href="/" style="color:var(--signal-2)">Browse all converters</a>.`
    );
    return;
  }

  await redirectToMatchingConverter({ files, detectedFmt, route });
}

function ensureModeForMatchingFiles(files) {
  if (conversionMode) return;
  if (!files.some((f) => inputFormat.matches(f))) return;
  const needsServer =
    outputFormat.localSupported === false || inputFormat.localSupported === false;
  setMode(needsServer ? 'server' : 'local');
}

async function processDroppedFiles(list) {
  const files = [...list];
  if (!files.length) return;

  const matching = files.filter((f) => inputFormat.matches(f));
  const other = files.filter((f) => !inputFormat.matches(f));

  if (!matching.length && other.length) {
    await handleMismatchedFiles(other);
    return;
  }

  ensureModeForMatchingFiles(matching);
  addFiles(list);
}

function addFiles(list, { scroll = true } = {}) {
  const files = [...list];
  const matching = files.filter((f) => inputFormat.matches(f));
  const other = files.filter((f) => !inputFormat.matches(f));
  const countBefore = fileStore.length;

  matching.forEach(pushFileToStore);
  converted = false;
  renderFiles();
  if (
    scroll &&
    fileStore.length > countBefore &&
    document.getElementById('uploadStep')?.classList.contains('ready')
  ) {
    scrollToConvertButton();
  }

  handleMismatchedFiles(other);
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

function markFileDownloaded(index) {
  const item = fileStore[index];
  if (!item || item.downloaded) return;
  item.downloaded = true;

  const card = filesEl.querySelector(`.result-card[data-i="${index}"]`);
  const link = card?.querySelector('[data-full-dl]');
  if (!link) return;

  const done = document.createElement('span');
  done.className = 'dl-unlocked is-downloaded';
  done.innerHTML = `${SVG_DONE} Downloaded`;
  link.replaceWith(done);
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
          <div class="stats">${fmtBytes(item.file.size)} ${inputFormat.label} <span class="arrow">→</span> ${outputFormat.label} · ${fmtTime(item.duration)}${item.sampleRate ? ' · ' + (item.sampleRate / 1000).toFixed(1) + 'kHz' : ''}</div>
        </div>
        <div class="est">${estBytes ? '≈ ' + fmtBytes(estBytes) : '—'}<small>at ${br}k</small></div>
        <button class="rm" data-rm="${i}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>`;
      row.querySelector('[data-rm]').addEventListener('click', () => removeFile(i));
      filesEl.appendChild(row);
    } else {
      const cap = item.unlocked
        ? item.duration || 0
        : Math.min(PREVIEW_PLAY_SECONDS, item.duration || PREVIEW_PLAY_SECONDS);
      const previewSub = item.unlocked
        ? 'Full length'
        : `${PREVIEW_PLAY_SECONDS}s listen · ${PREVIEW_DOWNLOAD_SECONDS}s download`;
      const card = document.createElement('div');
      card.className = 'result-card' + (item.unlocked ? ' unlocked' : '');
      card.dataset.i = i;

      const statsLabel =
        conversionMode === 'server'
          ? `Server · ${item.outputSize ? fmtBytes(item.outputSize) : '—'}`
          : `${br}k ${mode2} · ${ch} · ${estBytes ? '≈ ' + fmtBytes(estBytes) : '—'}`;

      card.innerHTML = `
        <div class="result-banner">
          <div class="result-banner-icon">${SVG_DONE}</div>
          <div class="result-banner-text">
            <strong>Conversion complete</strong>
            <span class="result-filename">${item.outputName}</span>
            <span class="stats">${statsLabel}</span>
          </div>
          <span class="ready-pill">READY</span>
        </div>
        <div class="result-section result-preview">
          <div class="result-section-head">${SVG_PREVIEW_HEAD} Preview your file<span class="sub">${previewSub}</span></div>
          <div class="preview">
            <button class="play-btn" data-play="${i}">${SVG_PLAY}</button>
            <div class="wave">${buildWave(item.file.name)}</div>
            <div class="ptime">0:00 / ${fmtTime(cap)}</div>
          </div>
          ${
            item.unlocked
              ? ''
              : `<div class="preview-actions">
            <button class="dl-preview" type="button" data-preview-dl="${i}">${SVG_DL} Download preview</button>
          </div>`
          }
        </div>
        <div class="result-section result-download">
          <div class="result-section-head">${SVG_DOWNLOAD_HEAD} Download your file</div>
          <div class="rc-actions">
          ${
            item.unlocked
              ? item.downloaded
                ? `<span class="dl-unlocked is-downloaded">${SVG_DONE} Downloaded</span>
                 <button class="btn-clear" data-clear="${i}">Clear from list</button>`
                : `<a class="dl-unlocked" href="${item.url}" download="${item.outputName}" data-full-dl="${i}">${SVG_DL} Download ${outputFormat.label}</a>
                 <button class="btn-clear" data-clear="${i}">Clear from list</button>`
              : `<button class="btn-unlock" data-unlock="${i}">${SVG_DL} Download ${outputFormat.label}</button>
                 <button class="btn-clear subtle" data-clear="${i}">Remove</button>`
          }
          </div>
          ${
            item.unlocked
              ? ''
              : '<p class="result-download-note">' +
                (freeTierExhausted()
                  ? `You've used your ${freeTier.limit} free conversions for today. Listen or download a ${PREVIEW_DOWNLOAD_SECONDS}-second preview above, or unlock for unlimited exports.`
                  : `Listen free, or download a ${PREVIEW_DOWNLOAD_SECONDS}-second preview above. Unlock to export the full file without limits.`) +
                '</p>'
          }
        </div>`;

      card.querySelector('[data-play]')?.addEventListener('click', () => togglePreview(i));
      card.querySelector('[data-preview-dl]')?.addEventListener('click', () => downloadPreviewClip(i));
      card.querySelector('[data-full-dl]')?.addEventListener('click', () => markFileDownloaded(i));
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
  if (!sum) return;
  if (fileStore.length === 0) {
    converted = false;
    sum.innerHTML = `<b>No files yet</b> — drop ${inputFormat.label} files above to get started.`;
    refreshActionButton();
    return;
  }

  const br = currentBitrate();
  const mode2 = document.querySelector('#mode2 .chip.on')?.textContent || 'CBR';
  const ch = document.querySelector('#channels .chip.on')?.textContent || 'Stereo';

  if (converted) {
    const locked = fileStore.filter((f) => !f.unlocked).length;
    const unlocked = fileStore.length - locked;
    if (locked > 0) {
      const lockNote = freeTierExhausted()
        ? `${unlocked > 0 ? `${unlocked} unlocked · ` : ''}<b>${locked} preview-only</b> — daily free limit reached`
        : `<b>${locked} preview-only</b>`;
      sum.innerHTML = `<b>${fileStore.length} file${fileStore.length > 1 ? 's' : ''} converted.</b> ${lockNote}.`;
    } else {
      sum.innerHTML = `<b>All unlocked.</b> Convert and export as much as you need.`;
    }
  } else if (conversionMode === 'server') {
    const totalIn = fileStore.reduce((a, f) => a + f.file.size, 0);
    sum.innerHTML = `<b>${fileStore.length} file${fileStore.length > 1 ? 's' : ''}</b> · server mode · ${fmtBytes(totalIn)} → ${outputFormat.label}${freeTierHintHtml()}`;
  } else {
    const totalIn = fileStore.reduce((a, f) => a + f.file.size, 0);
    const totalDur = fileStore.reduce((a, f) => a + (f.duration || 0), 0);
    const totalOut = (br * 1000 / 8) * totalDur;
    const saved =
      totalIn > totalOut && totalOut ? Math.round((1 - totalOut / totalIn) * 100) : 0;
    sum.innerHTML = `<b>${fileStore.length} file${fileStore.length > 1 ? 's' : ''}</b> · ${br}k ${mode2} · ${ch} · ${fmtBytes(totalIn)} → ${totalOut ? '≈ ' + fmtBytes(totalOut) : '—'}${saved ? ' · save ~' + saved + '%' : ''}${freeTierHintHtml()}`;
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

function previewDownloadName(outputName) {
  const base = outputName.replace(new RegExp('\\.' + outputFormat.ext + '$', 'i'), '');
  return `${base}-preview-${PREVIEW_DOWNLOAD_SECONDS}s.${outputFormat.ext}`;
}

async function getPreviewClipBlob(item) {
  if (item.previewClipBlob) return item.previewClipBlob;

  const ff = await loadFfmpeg();
  const ext = outputFormat.ext;
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const inFile = `prev-in-${token}.${ext}`;
  const outFile = `prev-out-${token}.${ext}`;

  await ff.writeFile(inFile, await fetchFile(item.blob));

  const trimArgs = (extra = []) => [
    '-i',
    inFile,
    '-t',
    String(PREVIEW_DOWNLOAD_SECONDS),
    ...extra,
    '-y',
    outFile,
  ];

  try {
    try {
      await ff.exec(trimArgs(['-c:a', 'copy']));
    } catch {
      await ff.exec(trimArgs());
    }
    const output = await ff.readFile(outFile);
    item.previewClipBlob = new Blob([output], { type: outputFormat.mime });
    return item.previewClipBlob;
  } finally {
    try {
      await ff.deleteFile(inFile);
    } catch {
      /* ignore */
    }
    try {
      await ff.deleteFile(outFile);
    } catch {
      /* ignore */
    }
  }
}

window.downloadPreviewClip = async function downloadPreviewClip(i, externalBtn = null) {
  const item = fileStore[i];
  if (!item?.blob) return;

  const btn = externalBtn || document.querySelector(`[data-preview-dl="${i}"]`);
  const isModalBtn = btn?.id === 'modalPreviewBtn';
  const modalLabel = isModalBtn ? btn.querySelector('#modalPreviewLabel') : null;
  const defaultCardLabel = `${SVG_DL} Download preview`;
  const defaultModalText = modalLabel?.dataset.defaultText || modalLabel?.textContent || '';

  if (btn) {
    btn.disabled = true;
    if (isModalBtn && modalLabel) {
      modalLabel.textContent = 'Preparing preview…';
    } else if (!isModalBtn) {
      btn.innerHTML = 'Preparing preview…';
    }
  }

  try {
    const blob = await getPreviewClipBlob(item);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = previewDownloadName(item.outputName);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    console.error('Preview download failed:', err);
    if (btn) {
      btn.disabled = false;
      if (isModalBtn && modalLabel) {
        modalLabel.textContent = 'Preview failed — try again';
        setTimeout(() => {
          modalLabel.textContent = defaultModalText;
        }, 2500);
      } else if (!isModalBtn) {
        btn.innerHTML = 'Preview download failed — try again';
        setTimeout(() => {
          btn.innerHTML = defaultCardLabel;
        }, 2500);
      }
    }
    throw err;
  }

  if (btn) {
    btn.disabled = false;
    if (isModalBtn && modalLabel) {
      modalLabel.textContent = defaultModalText;
    } else if (!isModalBtn) {
      btn.innerHTML = defaultCardLabel;
    }
  }
};

function modalPreviewIndices() {
  if (typeof unlockTarget === 'number') return [unlockTarget];
  return unlockIndices();
}

function modalPreviewLabel(count = 1) {
  if (count === 1) return `Download ${PREVIEW_DOWNLOAD_SECONDS}s preview`;
  return `Download ${PREVIEW_DOWNLOAD_SECONDS}s previews (${count} files)`;
}

function updateModalPreviewButton() {
  const btn = document.getElementById('modalPreviewBtn');
  if (!btn) return;

  const indices = modalPreviewIndices().filter((i) => fileStore[i]?.blob);
  const label = document.getElementById('modalPreviewLabel');
  btn.hidden = indices.length === 0;
  if (label) {
    label.textContent = modalPreviewLabel(indices.length);
    label.dataset.defaultText = label.textContent;
  }
  btn.disabled = false;
}

window.downloadModalPreview = async function downloadModalPreview() {
  const indices = modalPreviewIndices().filter((i) => fileStore[i]?.blob);
  if (!indices.length) return;

  const btn = document.getElementById('modalPreviewBtn');
  const label = document.getElementById('modalPreviewLabel');
  const defaultText = label?.dataset.defaultText || modalPreviewLabel(indices.length);

  if (btn) btn.disabled = true;

  try {
    for (let n = 0; n < indices.length; n++) {
      if (label && indices.length > 1) {
        label.textContent = `Preparing preview ${n + 1} of ${indices.length}…`;
      }
      await downloadPreviewClip(indices[n], indices.length === 1 ? btn : null);
      if (n < indices.length - 1) {
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  } catch {
    return;
  } finally {
    if (btn) {
      btn.disabled = false;
      if (label) label.textContent = defaultText;
    }
  }
};

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
  const args = ['-i', `input.${inputFormat.ext}`];
  const outFile = `output.${outputFormat.ext}`;

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

  if (outputFormat.audioOnly || inputFormat.stripVideo) args.push('-vn');

  if (outputFormat.isPcm) {
    args.push('-codec:a', 'pcm_s16le');
  } else {
    args.push('-codec:a', outputFormat.codec);
    if (outputFormat.lossless) {
      args.push('-compression_level', '8');
    } else if (outputFormat.codec === 'libmp3lame') {
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
    } else if (outputFormat.codec === 'libvorbis') {
      args.push('-q:a', '6');
    } else {
      args.push('-b:a', `${opts.bitrate}k`);
    }
  }

  // Skip -movflags +faststart in browser WASM — the second-pass moov relocation
  // can produce empty M4A/M4R/MP4 outputs in ffmpeg.wasm's in-memory filesystem.
  if (outputFormat.container) args.push('-f', 'mp4');

  if (opts.title) args.push('-metadata', `title=${opts.title}`);
  if (opts.artist) args.push('-metadata', `artist=${opts.artist}`);

  args.push('-y', outFile);
  return { args, outFile };
}

async function convertLocal(item, opts, onProgress) {
  if (inputFormat.localSupported === false) {
    throw new Error(`${inputFormat.label} conversion requires server mode in this browser`);
  }
  if (!outputFormat.localSupported) {
    throw new Error(`${outputFormat.label} conversion requires server mode in this browser`);
  }

  const ff = await loadFfmpeg(onProgress);
  const inputName = `input.${inputFormat.ext}`;
  const data = await fetchFile(item.file);
  await ff.writeFile(inputName, data);

  const { args, outFile } = buildFfmpegArgs(opts, item.duration);
  await ff.exec(args);

  const output = await ff.readFile(outFile);
  await ff.deleteFile(inputName);
  await ff.deleteFile(outFile);

  const blob = new Blob([output], { type: outputFormat.mime });
  return blob;
}

/* ---------- Zamzar server conversion ---------- */
const backOffIntervals = [5, 5, 10, 20, 30];
const MAX_POLL_FAILURES = 5;

async function convertServer(item, onProgress) {
  onProgress(5);
  const form = new FormData();
  form.append('file', item.file, item.file.name);
  form.append('target_format', outputFormat.zamzar);

  const startRes = await fetch('/api/convert/server', { method: 'POST', body: form });
  if (!startRes.ok) {
    const err = await startRes.json().catch(() => ({}));
    throw new Error(err.error || 'Server conversion failed to start');
  }
  const { jobToken } = await startRes.json();
  onProgress(15);

  let fileToken = null;
  let pollFailures = 0;
  let attempt = 0;

  while (!fileToken) {
    const waitSec = backOffIntervals[Math.min(attempt, backOffIntervals.length - 1)];
    await new Promise((r) => setTimeout(r, waitSec * 1000));

    let status;
    try {
      const statusRes = await fetch(`/api/convert/status/${encodeURIComponent(jobToken)}`);
      if (!statusRes.ok) throw new Error('Status request failed');
      status = await statusRes.json();
    } catch {
      pollFailures += 1;
      if (pollFailures >= MAX_POLL_FAILURES) {
        throw new Error('Failed to check conversion status after multiple attempts');
      }
      continue;
    }

    pollFailures = 0;

    if (status.status === 'successful') {
      fileToken = status.fileToken;
      break;
    }
    if (status.status === 'failed') {
      throw new Error(status.error || 'Server conversion failed');
    }

    onProgress(Math.min(85, 15 + attempt * 2));
    attempt += 1;
  }

  onProgress(90);
  const dlRes = await fetch(
    `/api/convert/download/${encodeURIComponent(fileToken)}?ext=${encodeURIComponent(outputFormat.ext)}`
  );
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
  item.previewClipBlob = null;
  item.unlocked = false;
  if (item.audio) {
    item.audio.pause();
    item.audio = null;
  }
}

async function logConversionAnalytics(item, mode) {
  try {
    await fetch('/api/events/conversion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        inputFormat: inputSlug,
        outputFormat: outputSlug,
        mode,
        fileSize: item.blob?.size || item.file?.size || null,
        duration: item.duration || null,
        savedToLibrary: !!item.libraryId,
      }),
    });
  } catch {
    // analytics are best-effort
  }
}

async function saveConversionToLibrary(item, mode) {
  if (!currentUser || !item.unlocked || !item.blob || item.libraryId) return;

  try {
    const form = new FormData();
    form.append('file', item.blob, item.outputName);
    form.append('mode', mode);
    form.append(
      'originalName',
      item.file?.name ||
        item.outputName.replace(
          new RegExp('\\.' + outputFormat.ext + '$', 'i'),
          '.' + inputFormat.ext
        )
    );
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
      refreshLibrarySection();
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
  if (!conversionMode || fileStore.length === 0 || converted) return;

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
      await finalizeItemUnlock(item);
      await saveConversionToLibrary(item, conversionMode);
      await logConversionAnalytics(item, conversionMode);
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
    : Math.min(PREVIEW_PLAY_SECONDS, item.duration || PREVIEW_PLAY_SECONDS);

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
  fileStore.forEach((it, i) => {
    if (!it.url || !it.unlocked) return;
    const a = document.createElement('a');
    a.href = it.url;
    a.download = it.outputName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    markFileDownloaded(i);
  });
};

/* ---------- subscription / unlock ---------- */
function isSubscribed() {
  return subscriptionActive;
}

function unlockAll() {
  subscriptionActive = true;
  freeTier = { ...freeTier, unlimited: true };
  dispatchFreeTierUpdate();
  fileStore.forEach((it) => {
    it.unlocked = true;
  });
  renderFiles();
  updateNavAuth();
  void saveAllToLibrary().then(() => refreshLibrarySection());
}

import {
  refreshLibraryPanel,
} from '/public/library-ui.js';

async function refreshLibrarySection() {
  const section = document.getElementById('librarySection');
  const list = document.getElementById('libraryRecent');
  const guest = document.getElementById('libraryGuest');
  if (!section) return;

  const data = await fetchAuthState();
  await refreshLibraryPanel({
    section,
    list,
    guest,
    limit: 6,
    isLoggedIn: !!data?.user,
  });
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
      link.href = '/account/';
      if (filesLink) {
        filesLink.hidden = false;
        filesLink.href = '/my-files/';
      }
    } else {
      link.textContent = 'Log in';
      link.href = '/login/';
      if (filesLink) {
        filesLink.hidden = false;
        filesLink.href = '/login/?next=' + encodeURIComponent('/my-files/');
      }
    }
    refreshLibrarySection();
  });
}

function unlockIndices() {
  return fileStore.map((_, i) => i).filter((i) => !fileStore[i].unlocked);
}

window.selectPlan = function selectPlan(plan) {
  selectedPlan = 'unlock';
  updateUnlockPriceLabels();
  dispatchFreeTierUpdate();
  window.refreshUnlockModalUrgency?.();
};

window.openUnlockModal = function openUnlockModal(target) {
  unlockTarget = target;
  if (unlockIndices().length === 0) return;

  const lockedCount = unlockIndices().length;
  const quotaExhausted = freeTierExhausted();
  const titleEl = document.getElementById('modalTitle');
  if (titleEl) {
    titleEl.textContent = quotaExhausted
      ? 'Daily free limit reached'
      : 'Unlock unlimited conversions';
  }

  document.getElementById('modalSub').innerHTML = quotaExhausted
    ? `You've used your <b>${freeTier.limit} free conversions</b> for today. Your files are still available as <b>${PREVIEW_PLAY_SECONDS}-second previews</b>${lockedCount > 1 ? ` (${lockedCount} files locked)` : ''}. Unlock for unlimited full-length exports — your free allocation resets tomorrow.`
    : `You've heard the <b>30-second preview</b>. Go Pro to unlock <b>unlimited conversions</b>${lockedCount > 1 ? ' for all your files' : ''} — full-length exports, every option, local or server.`;
  document.getElementById('getBox').innerHTML = quotaExhausted
    ? `<div class="gi">${SVG_CHECK} Unlimited conversions — no daily cap</div>
    <div class="gi">${SVG_CHECK} Full-length exports — no 30-second cap</div>
    <div class="gi">${SVG_CHECK} Every bitrate, VBR &amp; processing option</div>
    <div class="gi">${SVG_CHECK} Free allocation resets every day at midnight UTC</div>`
    : `<div class="gi">${SVG_CHECK} Unlimited conversions — local &amp; server</div>
    <div class="gi">${SVG_CHECK} Full-length exports — no 30-second cap</div>
    <div class="gi">${SVG_CHECK} Every bitrate, VBR &amp; processing option</div>
    <div class="gi">${SVG_CHECK} Batch convert with no watermark</div>`;
  updateUnlockPriceLabels();
  updateModalPreviewButton();
  document.getElementById('redirecting').classList.remove('show');
  document.getElementById('overlay').classList.add('show');
  if (freeTierExhausted()) {
    trackFunnelEvent('limit_modal_shown');
  }
  window.refreshUnlockModalUrgency?.();
  dispatchFreeTierUpdate();
};

window.closeModal = function closeModal() {
  const wasOpen = document.getElementById('overlay')?.classList.contains('show');
  document.getElementById('overlay').classList.remove('show');
  if (wasOpen) trackFunnelEvent('modal_closed');
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
      downloaded: false,
      audio: null,
      outputName: item.outputName,
      outputSize: item.outputSize,
    };
  });

  converted = true;
  if (saved.conversionMode) setMode(saved.conversionMode);
  else revealUploadStep();

  await clearPendingCheckout();
  renderFiles();
  return true;
}

window.goToStripeCheckout = async function goToStripeCheckout() {
  const redirecting = document.getElementById('redirecting');
  redirecting.classList.add('show');

  const returnTo = window.location.pathname + window.location.search;

  try {
    await savePendingCheckout({ conversionMode, items: fileStore, returnTo });

    const res = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnTo }),
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
        '\n\nIf Stripe is not configured yet, set STRIPE_SECRET_KEY and STRIPE_PRICE_UNLOCK in your .env file.'
    );
  }
};

async function checkSubscriptionOnLoad() {
  const data = await fetchAuthState();
  if (!data) {
    currentUser = null;
    await refreshFreeTier();
    return;
  }

  currentUser = data.user || null;
  subscriptionActive = !!data.subscriptionActive;
  if (data.freeTier) freeTier = data.freeTier;
  else if (!subscriptionActive) await refreshFreeTier();
  else dispatchFreeTierUpdate();
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
  if (e.key !== 'Escape') return;
  closeFormatModal();
  closeModal();
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

function configureFormatUI() {
  if (outputFormat.lossless || outputFormat.isPcm) {
    document.getElementById('bitrate')?.closest('.opt')?.setAttribute('hidden', '');
    document.getElementById('mode2')?.closest('.opt')?.setAttribute('hidden', '');
  }

  const metaLabel = document.querySelector('#metaTitle')?.closest('.opt')?.querySelector('label');
  if (metaLabel && outputFormat.slug !== 'mp3') {
    metaLabel.innerHTML = 'Metadata <span class="tag">-metadata</span>';
  }

  const needsServer =
    outputFormat.localSupported === false || inputFormat.localSupported === false;

  if (needsServer) {
    window.setMode('server');
    const modeText = document.getElementById('modeText');
    if (modeText) {
      const reason =
        inputFormat.localSupported === false
          ? `${inputFormat.label} decoding runs on our servers`
          : `${outputFormat.label} encoding runs on our servers`;
      modeText.innerHTML = `<b>Server mode required.</b> ${reason} — files are deleted after download.`;
    }
    document.querySelector('[data-mode="local"]')?.setAttribute('disabled', '');
  }
}

async function loadStagedHomeFiles() {
  try {
    const pending = await loadPendingFiles();
    if (!pending?.files?.length) return;
    if (pending.inputSlug && pending.inputSlug !== inputSlug) return;
    if (pending.outputSlug && pending.outputSlug !== outputSlug) return;

    const matching = pending.files.filter((f) => inputFormat.matches(f));
    if (!matching.length) return;

    await clearPendingFiles();

    if (!conversionMode) {
      ensureModeForMatchingFiles(matching);
    } else if (!document.getElementById('uploadStep')?.classList.contains('ready')) {
      revealUploadStep();
    }

    addFiles(pending.files, { scroll: false });

    if (fileStore.length > 0) {
      scrollToConvertButtonAfterLayout();
    }
  } catch (err) {
    console.warn('Could not restore staged files:', err);
  }
}

async function init() {
  document.getElementById('modalTestimonials')?.insertAdjacentHTML('beforeend', modalTestimonialsHtml());
  updateUnlockPriceLabels();
  configureFormatUI();
  applyPreset('music');
  await loadStagedHomeFiles();
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
