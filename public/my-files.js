import { requireAuth, formatDateTime, formatBytes } from '/public/auth.js';

const SVG_DL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M5 21h14"/></svg>';

let allFiles = [];

function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return m + ':' + String(sec).padStart(2, '0');
}

function modeLabel(mode) {
  return mode === 'server'
    ? { text: 'Server', hint: 'Converted via Zamzar API', class: 'server' }
    : { text: 'Local', hint: 'Converted in your browser', class: 'local' };
}

function getSelectedIds(container) {
  return [...container.querySelectorAll('.file-check:checked')].map((el) => Number(el.dataset.id));
}

function updateBatchBar(container) {
  const bar = container.querySelector('#batchBar');
  if (!bar) return;

  const checks = [...container.querySelectorAll('.file-check:not(:disabled)')];
  const selected = checks.filter((c) => c.checked);
  const selectAll = container.querySelector('#selectAll');
  const downloadBtn = container.querySelector('#batchDownload');
  const countEl = container.querySelector('#batchCount');

  if (selectAll) {
    selectAll.checked = checks.length > 0 && selected.length === checks.length;
    selectAll.indeterminate = selected.length > 0 && selected.length < checks.length;
  }

  if (downloadBtn) {
    downloadBtn.disabled = selected.length === 0;
    downloadBtn.innerHTML =
      selected.length > 1
        ? `${SVG_DL} Download ${selected.length} files as ZIP`
        : selected.length === 1
          ? `${SVG_DL} Download selected`
          : `${SVG_DL} Download selected`;
  }

  if (countEl) {
    countEl.textContent =
      selected.length > 0 ? `${selected.length} selected` : checks.length ? 'Select files to batch download' : '';
  }
}

function wireBatchControls(container) {
  const selectAll = container.querySelector('#selectAll');
  const downloadBtn = container.querySelector('#batchDownload');

  selectAll?.addEventListener('change', () => {
    container.querySelectorAll('.file-check:not(:disabled)').forEach((c) => {
      c.checked = selectAll.checked;
    });
    updateBatchBar(container);
  });

  container.querySelectorAll('.file-check').forEach((c) => {
    c.addEventListener('change', () => updateBatchBar(container));
  });

  downloadBtn?.addEventListener('click', () => batchDownload(container));
}

async function batchDownload(container) {
  const ids = getSelectedIds(container);
  if (!ids.length) return;

  const btn = container.querySelector('#batchDownload');
  const label = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Preparing ZIP…';
  }

  try {
    const res = await fetch('/api/files/download-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ ids }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Download failed');
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `youconvert-${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(err.message || 'Could not download files.');
  } finally {
    if (btn) {
      btn.disabled = getSelectedIds(container).length === 0;
      btn.innerHTML = label || `${SVG_DL} Download selected`;
      updateBatchBar(container);
    }
  }
}

function renderFiles(container, files) {
  allFiles = files;

  if (!files.length) {
    container.innerHTML =
      '<p class="empty">No saved conversions yet. Convert a WAV while logged in and your files will appear here.</p>';
    return;
  }

  const availableCount = files.filter((f) => f.available).length;

  container.innerHTML = `
    <div class="batch-bar" id="batchBar"${availableCount ? '' : ' hidden'}>
      <label class="batch-check">
        <input type="checkbox" id="selectAll">
        <span>Select all</span>
      </label>
      <button type="button" class="btn-batch" id="batchDownload" disabled>${SVG_DL} Download selected</button>
      <span class="batch-count" id="batchCount">Select files to batch download</span>
    </div>
    <table class="inv-table files-table">
      <thead>
        <tr>
          <th class="check-col"></th>
          <th>File</th>
          <th>Converted</th>
          <th>Mode</th>
          <th>Size</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${files
          .map((file) => {
            const mode = modeLabel(file.mode);
            return `
          <tr data-id="${file.id}">
            <td class="check-col">
              <input type="checkbox" class="file-check" data-id="${file.id}"${file.available ? '' : ' disabled'}>
            </td>
            <td>
              <div class="file-name">${file.outputName}</div>
              <div class="file-sub">${file.originalName}${file.duration ? ' · ' + formatTime(file.duration) : ''}</div>
            </td>
            <td class="mono">${formatDateTime(file.createdAt)}</td>
            <td><span class="mode-badge ${mode.class}" title="${mode.hint}">${mode.text}</span></td>
            <td class="mono">${formatBytes(file.fileSize)}</td>
            <td>${
              file.available
                ? '<span class="status paid">Available</span>'
                : '<span class="status unavailable">Unavailable</span>'
            }</td>
            <td class="inv-actions">
              ${
                file.available
                  ? `<a class="btn-dl" href="/api/files/${file.id}/download">${SVG_DL} Download</a>`
                  : ''
              }
              <button class="btn-del" data-delete="${file.id}" type="button">Delete</button>
            </td>
          </tr>`;
          })
          .join('')}
      </tbody>
    </table>`;

  container.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => deleteFile(btn.dataset.delete, container));
  });

  wireBatchControls(container);
  updateBatchBar(container);
}

async function deleteFile(id, container) {
  if (!confirm('Delete this file from your library? This cannot be undone.')) return;

  const res = await fetch(`/api/files/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!res.ok) {
    alert('Could not delete this file.');
    return;
  }

  allFiles = allFiles.filter((f) => f.id !== Number(id));
  renderFiles(container, allFiles);
}

async function init() {
  const me = await requireAuth('/login.html?next=' + encodeURIComponent('/my-files.html'));
  if (!me) return;

  const container = document.getElementById('filesList');

  try {
    const res = await fetch('/api/files', { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    renderFiles(container, data.files || []);
  } catch {
    container.innerHTML = '<p class="empty">Could not load your files. Try again later.</p>';
  }
}

init();
