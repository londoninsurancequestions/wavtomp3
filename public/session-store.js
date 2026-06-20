const DB_NAME = 'wavtomp3';
const DB_VERSION = 1;
const STORE = 'pending';
const CHECKOUT_KEY = 'checkout';
const HOME_FILES_KEY = 'home-files';
const HOME_FILES_TTL_MS = 30 * 60 * 1000;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
  });
}

export function appendQueryParams(path, paramsObj) {
  const [pathname, search = ''] = path.split('?');
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(paramsObj)) {
    if (value != null) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** Where to send the user after signup/login to restore unlocked conversions. */
export function postAuthRedirectUrl(returnTo, { welcome = false } = {}) {
  const path = (returnTo || '/').split('#')[0];
  const query = { restore: '1' };
  if (welcome) query.welcome = '1';
  return `${appendQueryParams(path, query)}#converter`;
}

export async function savePendingCheckout({ conversionMode, items, returnTo }) {
  const converted = (items || []).filter((i) => i.state === 'converted' && i.blob);
  if (!converted.length && !returnTo) return false;

  const payload = {
    conversionMode,
    returnTo: returnTo || null,
    converted: converted.length > 0,
    items: converted.map((i) => ({
      originalName: i.file?.name || i.outputName.replace(/\.mp3$/i, '.wav'),
      duration: i.duration,
      sampleRate: i.sampleRate,
      outputName: i.outputName,
      outputSize: i.outputSize,
      blob: i.blob,
    })),
    savedAt: Date.now(),
  };

  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(payload, CHECKOUT_KEY);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadPendingCheckout() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(CHECKOUT_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function clearPendingCheckout() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(CHECKOUT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function hasPendingCheckout() {
  const data = await loadPendingCheckout();
  return !!(data?.items?.length || data?.returnTo);
}

export async function savePendingFiles(files, inputSlug = 'wav', { outputSlug = null } = {}) {
  if (!files?.length) return false;

  const payload = {
    inputSlug,
    outputSlug,
    files: [...files].map((f) => ({
      name: f.name,
      type: f.type || 'audio/wav',
      lastModified: f.lastModified,
      blob: f,
    })),
    savedAt: Date.now(),
  };

  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(payload, HOME_FILES_KEY);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadPendingFiles() {
  const db = await openDb();
  const data = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(HOME_FILES_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });

  if (!data?.files?.length) return null;
  if (Date.now() - data.savedAt > HOME_FILES_TTL_MS) {
    await clearPendingFiles();
    return null;
  }

  const files = data.files.map(
    (f) => new File([f.blob], f.name, { type: f.type, lastModified: f.lastModified })
  );
  return { files, inputSlug: data.inputSlug || 'wav', outputSlug: data.outputSlug || null };
}

export async function clearPendingFiles() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(HOME_FILES_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
