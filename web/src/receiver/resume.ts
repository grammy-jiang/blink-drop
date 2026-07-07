// Encrypted-at-rest persistence of a partial receiver assembly (docs/11).
//
// An interrupted scan otherwise restarts at 0%. We persist the received UR part
// strings (replayed on resume) so it can continue. The stored blob is
// AES-GCM-encrypted with a receiver-local NON-EXTRACTABLE key kept in IndexedDB,
// so no readable file bytes ever hit disk for ANY transfer (D5) — plaintext or
// encrypted. Single slot; expires after 24h; cleared on a verified transfer.
//
// Split: the crypto + expiry are pure (unit-tested with an injected key); the
// IndexedDB + non-extractable-key handling is browser-verified (a CryptoKey is
// structured-cloned into IDB, which node's fake IDB cannot reproduce).

const DB_NAME = "blink-drop";
const DB_VERSION = 1;
const STORE = "resume";
const KEY_ID = "atrest-key";
const REC_ID = "partial";
const EXPIRY_MS = 24 * 60 * 60 * 1000;

export interface ResumePartial {
  parts: string[];
  percent: number;
  frames: number;
  savedAt: number;
}

export interface StoredBlob {
  iv: Uint8Array;
  ct: Uint8Array;
  savedAt: number;
}

const asBuf = (u: Uint8Array): BufferSource => u as unknown as BufferSource;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---- pure crypto + expiry (unit-testable with any AES-GCM key) ----

export async function encryptPartial(key: CryptoKey, partial: ResumePartial): Promise<StoredBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(partial));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: asBuf(iv) }, key, asBuf(plaintext));
  return { iv, ct: new Uint8Array(ct), savedAt: partial.savedAt };
}

export async function decryptPartial(key: CryptoKey, blob: StoredBlob): Promise<ResumePartial> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: asBuf(blob.iv) }, key, asBuf(blob.ct));
  return JSON.parse(decoder.decode(new Uint8Array(pt))) as ResumePartial;
}

export function isExpired(savedAt: number, now: number, ttl: number = EXPIRY_MS): boolean {
  return now - savedAt > ttl;
}

// ---- IndexedDB + non-extractable key (browser) ----

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readwrite").objectStore(STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readwrite").objectStore(STORE).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// A non-extractable AES-GCM key, generated once and stored (as a CryptoKey handle)
// in IndexedDB. Non-extractable → its raw bytes can't be read back out of storage.
async function getOrCreateKey(db: IDBDatabase): Promise<CryptoKey> {
  const existing = await idbGet<CryptoKey>(db, KEY_ID);
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await idbPut(db, KEY_ID, key);
  return key;
}

export async function save(partial: ResumePartial): Promise<void> {
  const db = openDbSafe();
  if (!db) return;
  try {
    const idb = await db;
    const key = await getOrCreateKey(idb);
    await idbPut(idb, REC_ID, await encryptPartial(key, partial));
    idb.close();
  } catch {
    // Persistence is best-effort — never let it break a live scan.
  }
}

export async function load(): Promise<ResumePartial | null> {
  const db = openDbSafe();
  if (!db) return null;
  try {
    const idb = await db;
    const blob = await idbGet<StoredBlob>(idb, REC_ID);
    if (!blob) {
      idb.close();
      return null;
    }
    if (isExpired(blob.savedAt, Date.now())) {
      await idbDelete(idb, REC_ID);
      idb.close();
      return null;
    }
    const key = await idbGet<CryptoKey>(idb, KEY_ID);
    if (!key) {
      idb.close();
      return null;
    }
    const partial = await decryptPartial(key, blob);
    idb.close();
    return partial;
  } catch {
    return null; // missing/corrupt/undecryptable → treat as no partial
  }
}

export async function clear(): Promise<void> {
  const db = openDbSafe();
  if (!db) return;
  try {
    const idb = await db;
    await idbDelete(idb, REC_ID);
    idb.close();
  } catch {
    // best-effort
  }
}

// IndexedDB may be absent (older/locked-down browsers) — degrade to no-resume.
function openDbSafe(): Promise<IDBDatabase> | null {
  if (typeof indexedDB === "undefined") return null;
  return openDb();
}
