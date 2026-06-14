export function initPdfToEpub({ presets, defaultPreset, emptySummary }) {
  const drop = document.getElementById('drop');
  const fileInput = document.getElementById('fileInput');
  const fileCard = document.getElementById('fileCard');
  const fileName = document.getElementById('fileName');
  const fileMeta = document.getElementById('fileMeta');
  const clearFileBtn = document.getElementById('clearFileBtn');
  const goBtn = document.getElementById('goBtn');
  const summary = document.getElementById('summary');
  const prog = document.getElementById('prog');
  const progBar = document.getElementById('progBar');
  const errorEl = document.getElementById('error');
  const presetBar = document.getElementById('presets');

  let selectedFile = null;
  const convertBtnHtml = goBtn.innerHTML;

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function showError(message) {
    if (!message) {
      errorEl.hidden = true;
      errorEl.textContent = '';
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = message;
  }

  function setProgress(pct) {
    if (pct <= 0) {
      prog.classList.remove('on');
      progBar.style.width = '0%';
      return;
    }
    prog.classList.add('on');
    progBar.style.width = `${Math.min(100, pct)}%`;
  }

  function setChipGroup(id, value) {
    const group = document.getElementById(id);
    if (!group) return;
    group.querySelectorAll('.chip').forEach((chip) => {
      chip.classList.toggle('on', chip.dataset.value === value);
    });
  }

  function setSwitch(id, on) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('on', !!on);
  }

  function readOptions() {
    const profile = document.querySelector('#profile .chip.on')?.dataset.value || 'kindle';
    const textSize = document.querySelector('#textSize .chip.on')?.dataset.value || 'default';
    const layout = document.querySelector('#layout .chip.on')?.dataset.value || 'reflow';
    const chapters = document.querySelector('#chapters .chip.on')?.dataset.value || 'headings';

    return {
      profile,
      textSize,
      layout,
      chapters,
      heuristics: document.getElementById('heuristicsSwitch')?.classList.contains('on'),
      embedFonts: document.getElementById('embedFontsSwitch')?.classList.contains('on'),
      removePageNumbers: document.getElementById('removePageNumbersSwitch')?.classList.contains('on'),
      blankLineParagraphs: document.getElementById('blankLineSwitch')?.classList.contains('on'),
      title: document.getElementById('metaTitle')?.value.trim() || '',
      author: document.getElementById('metaAuthor')?.value.trim() || '',
    };
  }

  function applyPreset(name) {
    const preset = presets[name];
    if (!preset) return;

    setChipGroup('profile', preset.profile);
    setChipGroup('textSize', preset.textSize);
    setChipGroup('layout', preset.layout);
    setChipGroup('chapters', preset.chapters);
    setSwitch('heuristicsSwitch', preset.heuristics);
    setSwitch('embedFontsSwitch', preset.embedFonts);
    setSwitch('removePageNumbersSwitch', preset.removePageNumbers);
    setSwitch('blankLineSwitch', preset.blankLineParagraphs);

    presetBar.querySelectorAll('.preset').forEach((el) => {
      el.classList.toggle('on', el.dataset.preset === name);
    });
  }

  function setFile(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showError('Please choose a PDF file.');
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      showError('PDF must be 100 MB or smaller.');
      return;
    }

    selectedFile = file;
    showError('');
    drop.hidden = true;
    fileCard.hidden = false;
    fileName.textContent = file.name;
    fileMeta.textContent = formatBytes(file.size);
    goBtn.disabled = false;
    summary.innerHTML = `<b>Ready.</b> ${file.name} → EPUB`;
  }

  function clearFile() {
    selectedFile = null;
    fileInput.value = '';
    drop.hidden = false;
    fileCard.hidden = true;
    goBtn.disabled = true;
    setProgress(0);
    summary.innerHTML = emptySummary;
    showError('');
  }

  function bindChipGroup(id) {
    const group = document.getElementById(id);
    if (!group) return;
    group.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      group.querySelectorAll('.chip').forEach((el) => el.classList.remove('on'));
      chip.classList.add('on');
      presetBar.querySelectorAll('.preset').forEach((el) => el.classList.remove('on'));
    });
  }

  function bindSwitch(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', () => {
      el.classList.toggle('on');
      presetBar.querySelectorAll('.preset').forEach((p) => p.classList.remove('on'));
    });
  }

  ['profile', 'textSize', 'layout', 'chapters'].forEach(bindChipGroup);
  ['heuristicsSwitch', 'embedFontsSwitch', 'removePageNumbersSwitch', 'blankLineSwitch'].forEach(
    bindSwitch
  );

  presetBar.addEventListener('click', (e) => {
    const preset = e.target.closest('.preset');
    if (!preset) return;
    applyPreset(preset.dataset.preset);
  });

  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('drag');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('drag');
    const file = e.dataTransfer.files?.[0];
    if (file) setFile(file);
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) setFile(file);
  });

  clearFileBtn.addEventListener('click', clearFile);

  goBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    showError('');
    goBtn.disabled = true;
    goBtn.textContent = 'Converting…';
    setProgress(12);

    const form = new FormData();
    form.append('file', selectedFile, selectedFile.name);
    form.append('options', JSON.stringify(readOptions()));

    try {
      setProgress(35);
      const res = await fetch('/api/convert/ebook', { method: 'POST', body: form });
      setProgress(80);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Conversion failed');
      }

      const blob = await res.blob();
      const base = selectedFile.name.replace(/\.pdf$/i, '') || 'document';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${base}.epub`;
      a.click();
      URL.revokeObjectURL(url);

      setProgress(100);
      summary.innerHTML = `<b>Done.</b> Downloaded ${base}.epub`;
      setTimeout(() => setProgress(0), 1200);
    } catch (err) {
      showError(err.message || 'Something went wrong. Please try again.');
      setProgress(0);
    } finally {
      goBtn.disabled = false;
      goBtn.innerHTML = convertBtnHtml;
    }
  });

  applyPreset(defaultPreset);
}
