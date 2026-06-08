const DB_NAME = 'wavtomp3';
const DB_VERSION = 1;
const STORE = 'pending';
const CHECKOUT_KEY = 'checkout';

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

export async function savePendingCheckout({ conversionMode, items }) {
  const converted = items.filter((i) => i.state === 'converted' && i.blob);
  if (!converted.length) return false;

  const payload = {
    conversionMode,
    converted: true,
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
  return !!(data?.items?.length);
}
