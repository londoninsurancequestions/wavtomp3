import { formatDateTime, formatBytes } from '/public/auth.js';

const SVG_DL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M5 21h14"/></svg>';
const SVG_DONE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>';

export function formatDuration(seconds) {
  if (!seconds || !isFinite(seconds)) return '';
  const m = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return m + ':' + String(sec).padStart(2, '0');
}

export function wireDownloadState(root = document) {
  root.querySelectorAll('[data-library-dl]').forEach((link) => {
    if (link.dataset.wired) return;
    link.dataset.wired = '1';
    link.addEventListener('click', () => {
      link.classList.add('is-downloaded');
      link.innerHTML = `${SVG_DONE} Downloaded`;
      link.removeAttribute('href');
      link.style.pointerEvents = 'none';
    });
  });
}

export function renderLibraryGuest(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="library-guest">
      <p><a href="/login/?next=${encodeURIComponent('/my-files/')}">Log in</a> to save conversions to your library and download them again from any device.</p>
    </div>`;
}

export function renderLibraryEmpty(container, { compact = false } = {}) {
  if (!container) return;
  container.innerHTML = compact
    ? '<p class="library-empty">No saved conversions yet. Convert a file while logged in and it will appear here automatically.</p>'
    : '<p class="empty">No saved conversions yet. Convert a file while logged in and it will appear here — ready to download anytime.</p>';
}

export function renderLibraryRecent(container, files, { limit = 6 } = {}) {
  if (!container) return;

  const available = files.filter((f) => f.available);
  if (!available.length) {
    renderLibraryEmpty(container, { compact: true });
    return;
  }

  const shown = available.slice(0, limit);
  container.innerHTML = `
    <div class="library-grid">
      ${shown
        .map(
          (file) => `
        <article class="library-card" data-id="${file.id}">
          <div class="library-card-top">
            <div class="library-card-name">${escapeHtml(file.outputName)}</div>
            <div class="library-card-meta">${escapeHtml(file.originalName)}${file.duration ? ' · ' + formatDuration(file.duration) : ''}</div>
          </div>
          <div class="library-card-foot">
            <span class="library-card-date">${formatDateTime(file.createdAt)}</span>
            <span class="library-card-size">${formatBytes(file.fileSize)}</span>
          </div>
          <a class="library-card-dl" href="/api/files/${file.id}/download" data-library-dl>${SVG_DL} Download</a>
        </article>`
        )
        .join('')}
    </div>`;

  wireDownloadState(container);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function fetchLibraryFiles() {
  const res = await fetch('/api/files', { credentials: 'include' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not load files');
  return data.files || [];
}

export async function refreshLibraryPanel({ section, list, guest, limit = 6, isLoggedIn }) {
  if (!section || !list) return;

  section.hidden = false;

  if (!isLoggedIn) {
    if (guest) guest.hidden = false;
    list.hidden = true;
    renderLibraryGuest(guest || list);
    return;
  }

  if (guest) guest.hidden = true;
  list.hidden = false;
  list.innerHTML = '<p class="library-loading">Loading your files…</p>';

  try {
    const files = await fetchLibraryFiles();
    renderLibraryRecent(list, files, { limit });
  } catch {
    list.innerHTML = '<p class="library-empty">Could not load your files. <a href="/my-files/">Open My files</a></p>';
  }
}
