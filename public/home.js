import { fetchMe } from '/public/auth.js';
import { savePendingFiles } from '/public/session-store.js';
import { getInputFormat, assignInputFormat, getRoutes } from '/public/conversion-formats.js';
import { refreshLibraryPanel } from '/public/library-ui.js';

const drop = document.getElementById('drop');
const input = document.getElementById('fileInput');
const dropTitle = document.getElementById('dropTitle');
const dropSub = document.getElementById('dropSub');
const dropHint = document.getElementById('dropHint');
const pickerOverlay = document.getElementById('pickerOverlay');
const pickerGrid = document.getElementById('pickerGrid');
const pickerTitle = document.getElementById('pickerTitle');
const pickerSub = document.getElementById('pickerSub');

let stagedFiles = [];
let stagedInput = null;

function resetDropUi() {
  stagedFiles = [];
  stagedInput = null;
  drop.classList.remove('has-files');
  dropTitle.textContent = 'Drop your audio files here';
  dropSub.innerHTML = "or <span class=\"browse\">browse to upload</span> — we'll ask which format you want";
  dropHint.innerHTML = 'Drop files above to convert — or <a href="/converters/">browse all converters</a>.';
}

function renderPickerGrid(inputSlug) {
  const inputLabel = getInputFormat(inputSlug).label;
  const routes = getRoutes(inputSlug)
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label));

  pickerGrid.innerHTML = routes
    .map(
      (route) => `<button type="button" class="picker-opt" data-path="${route.path}" data-output="${route.slug}">
      <span class="picker-route"><span class="from">${inputLabel}</span><span class="arrow">→</span><span class="to">${route.label}</span></span>
      <span class="picker-blurb">${route.homeBlurb}</span>
    </button>`
    )
    .join('');

  pickerGrid.querySelectorAll('.picker-opt').forEach((btn) => {
    btn.addEventListener('click', () =>
      goToConverter(btn.dataset.path, btn.dataset.output)
    );
  });
}

function openPicker(files, inputSlug) {
  stagedFiles = files;
  stagedInput = inputSlug;
  const inputFmt = getInputFormat(inputSlug);
  const countLabel = files.length === 1 ? '1 file' : `${files.length} files`;

  drop.classList.add('has-files');
  dropTitle.textContent =
    files.length === 1
      ? `1 ${inputFmt.label} file ready`
      : `${files.length} ${inputFmt.label} files ready`;
  dropSub.innerHTML = 'Choose your output format in the dialog';

  pickerTitle.textContent = `Convert ${inputFmt.label} to…`;
  pickerSub.innerHTML = `<b>${countLabel}</b> ready — pick your output format.`;
  renderPickerGrid(inputSlug);
  pickerOverlay.classList.add('show');
}

window.closePicker = function closePicker() {
  pickerOverlay.classList.remove('show');
  pickerGrid.querySelectorAll('.picker-opt').forEach((btn) => {
    btn.disabled = false;
  });
  resetDropUi();
};

async function goToConverter(path, outputSlug) {
  if (!stagedFiles.length || !stagedInput) return;

  pickerGrid.querySelectorAll('.picker-opt').forEach((el) => {
    el.disabled = true;
  });
  pickerSub.innerHTML = '<b>Saving files…</b> Opening converter.';

  try {
    await savePendingFiles(stagedFiles, stagedInput, { outputSlug });
    window.location.href = path;
  } catch (err) {
    console.error('Could not stage files:', err);
    pickerSub.innerHTML =
      '<b>Could not save files.</b> Try again, or pick a converter from the <a href="/converters/">full list</a>.';
    renderPickerGrid(stagedInput);
  }
}

function handleFiles(list) {
  const map = new Map();
  for (const file of list) {
    const fmt = assignInputFormat(file);
    if (!fmt) continue;
    if (!map.has(fmt.slug)) map.set(fmt.slug, { fmt, files: [] });
    map.get(fmt.slug).files.push(file);
  }
  const buckets = [...map.values()];

  if (buckets.length === 0) {
    dropHint.innerHTML =
      '<b>Unsupported file type.</b> We support WAV, MP3, M4A, MP4, AAC, OGG, and WMA.';
    return;
  }

  if (buckets.length > 1) {
    dropHint.innerHTML =
      '<b>Mixed formats detected.</b> Please drop only one format at a time.';
    return;
  }

  openPicker(buckets[0].files, buckets[0].fmt.slug);
}

drop.addEventListener('click', () => input.click());
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('drag');
});
drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('drag');
  handleFiles(e.dataTransfer.files);
});
input.addEventListener('change', () => {
  handleFiles(input.files);
  input.value = '';
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pickerOverlay.classList.contains('show')) {
    closePicker();
  }
});

async function updateNavAuth() {
  const navAccount = document.getElementById('navAccount');
  const navFiles = document.getElementById('navFiles');
  if (!navAccount) return;

  const data = await fetchMe();
  if (data?.user) {
    navAccount.textContent = 'Account';
    navAccount.href = '/account/';
    if (navFiles) {
      navFiles.hidden = false;
      navFiles.href = '/my-files/';
    }
  } else if (navFiles) {
    navFiles.hidden = false;
    navFiles.href = '/login/?next=' + encodeURIComponent('/my-files/');
  }

  await refreshLibraryPanel({
    section: document.getElementById('librarySection'),
    list: document.getElementById('libraryRecent'),
    guest: document.getElementById('libraryGuest'),
    limit: 3,
    isLoggedIn: !!data?.user,
  });
}

updateNavAuth();
