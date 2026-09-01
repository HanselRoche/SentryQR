/**
 * IndexedDB storage for the device's signing key.
 *
 * IndexedDB is used rather than localStorage because it can store a CryptoKey
 * object directly via structured clone. localStorage only holds strings, which
 * would force the key to be exportable — defeating the entire point.
 */

const DB_NAME = 'sentryqr';
const DB_VERSION = 1;
const STORE = 'device-keys';
const RECORD_KEY = 'signing-key';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = fn(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Persist the keypair.
 *
 * The private CryptoKey is stored as an opaque handle. Because it was created
 * with extractable=false, the browser will never serialize the key material
 * itself — not to disk, not to JSON, not to another origin. What lands in
 * IndexedDB is a reference the browser can use for signing and nothing else.
 */
export async function saveKeyPair({ privateKey, publicKey, kid }) {
  const db = await openDb();
  try {
    await tx(db, 'readwrite', (store) =>
      store.put({ privateKey, publicKey, kid, createdAt: Date.now() }, RECORD_KEY),
    );
  } finally {
    db.close();
  }
}

export async function loadKeyPair() {
  const db = await openDb();
  try {
    return (await tx(db, 'readonly', (store) => store.get(RECORD_KEY))) ?? null;
  } finally {
    db.close();
  }
}

export async function hasKeyPair() {
  return (await loadKeyPair()) !== null;
}

/** Used when a student re-enrols this device, or to reset during a demo. */
export async function clearKeyPair() {
  const db = await openDb();
  try {
    await tx(db, 'readwrite', (store) => store.delete(RECORD_KEY));
  } finally {
    db.close();
  }
}
