import { fetchMe } from '/public/auth.js';
import { savePendingFiles } from '/public/session-store.js';
import { getInputFormat, INPUT_DETECTORS } from '/public/conversion-formats.js';

const drop = document.getElementById('drop');
const input = document.getElementById('fileInput');
const dropTitle = document.getElementById('dropTitle');
const dropSub = document.getElementById('dropSub');
const dropHint = document.getElementById('dropHint');

let stagedFiles = [];
let stagedInput = null;

function clearHighlights() {
  document.querySelectorAll('.format-cta').forEach((el) => el.classList.remove('highlight'));
}

function setFilesSelected(files, inputSlug) {
  stagedFiles = files;
  stagedInput = inputSlug;
  const inputFmt = getInputFormat(inputSlug);

  drop.classList.toggle('has-files', files.length > 0);
  clearHighlights();

  if (files.length > 0) {
    dropTitle.textContent =
      files.length === 1
        ? `1 ${inputFmt.label} file ready`
        : `${files.length} ${inputFmt.label} files ready`;
    dropSub.innerHTML =
      'Now pick a <span class="browse">converter below</span> for your format';
    dropHint.innerHTML = `<b>Files staged.</b> Choose a ${inputFmt.label} converter — your files will be waiting on the next page.`;
    document
      .getElementById(`formats-${inputSlug}`)
      ?.querySelectorAll('.format-cta')
      .forEach((el) => el.classList.add('highlight'));
  }
}

function handleFiles(list) {
  const buckets = INPUT_DETECTORS.map((fmt) => ({
    fmt,
    files: [...list].filter((f) => fmt.matches(f)),
  })).filter((b) => b.files.length > 0);

  if (buckets.length > 1) {
    dropHint.innerHTML =
      '<b>Mixed formats detected.</b> Please drop only one format at a time.';
    return;
  }
  if (buckets.length === 1) {
    setFilesSelected(buckets[0].files, buckets[0].fmt.slug);
  }
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

document.addEventListener('click', async (e) => {
  const link = e.target.closest('.format-cta');
  if (!link || stagedFiles.length === 0) return;
  if (link.dataset.input !== stagedInput) return;

  e.preventDefault();
  dropHint.innerHTML = '<b>Saving files…</b> Opening converter.';

  try {
    await savePendingFiles(stagedFiles, stagedInput);
    window.location.href = link.href;
  } catch (err) {
    console.error('Could not stage files:', err);
    dropHint.innerHTML =
      '<b>Could not save files for transfer.</b> Try again, or open a converter and upload there.';
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
    if (navFiles) navFiles.hidden = false;
  }
}

updateNavAuth();
