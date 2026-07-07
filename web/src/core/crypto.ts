// Passphrase encryption for the file envelope (docs/07-implementation-plan-v0.3
// §3). WebCrypto-native — AES-256-GCM (AEAD) under a PBKDF2-HMAC-SHA-256 key —
// so the offline single-file sender needs NO wasm/library blob, and the core
// stays isomorphic (browser and node ≥ 20 both expose crypto.subtle).
//
// This is symmetric, passphrase-derived crypto shared out-of-band between two
// people (§2 threat model) — NOT public-key/recipient-directed encryption.
// The passphrase never enters the QR, storage, or any log; only the KDF salt,
// GCM nonce, and algorithm ids travel (in the cleartext outer header, §4).

// Thrown when AES-GCM authentication fails: wrong passphrase (overwhelmingly
// likely) or tampered ciphertext. The receiver maps this to a distinct,
// file-withheld "wrong passphrase" state — never the generic corruption state.
export class WrongPassphraseError extends Error {
  override name = "WrongPassphraseError";
}

// The WebCrypto surface types byte inputs as BufferSource (ArrayBuffer-backed);
// a Uint8Array is a valid view. Same cast the rest of core uses (digest.ts).
const asBuf = (u: Uint8Array): BufferSource => u as unknown as BufferSource;
const encoder = new TextEncoder();

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

// passphrase + salt → a 256-bit AES-GCM key via PBKDF2-HMAC-SHA-256. A fresh
// salt per transfer means a reused passphrase still yields a distinct key.
export async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", asBuf(encoder.encode(passphrase)), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: asBuf(salt), iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// Import raw 32-byte key material as an AES-256-GCM key.
async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", asBuf(raw), { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export interface Argon2Params {
  m: number; // memory in KiB
  t: number; // time / iterations
  p: number; // parallelism
}

// Argon2id via hash-wasm. The wasm is embedded as base64 inside hash-wasm's JS
// (no external .wasm), so the single-file offline sender stays a single file;
// and it is lazily imported here so the PBKDF2/plaintext paths never pull it.
// Memory-hard → far costlier to brute-force offline than PBKDF2 (docs/09).
export async function deriveKeyArgon2(passphrase: string, salt: Uint8Array, params: Argon2Params): Promise<CryptoKey> {
  const { argon2id } = await import("hash-wasm");
  const raw = await argon2id({
    password: passphrase,
    salt,
    memorySize: params.m,
    iterations: params.t,
    parallelism: params.p,
    hashLength: 32,
    outputType: "binary",
  });
  return importAesKey(raw);
}

// AES-256-GCM. `aad` (the cleartext outer header) is authenticated but not
// encrypted, binding the KDF/cipher params to the ciphertext so they cannot be
// downgraded without breaking the tag.
export async function aesGcmEncrypt(
  key: CryptoKey,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const out = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBuf(nonce), additionalData: asBuf(aad) },
    key,
    asBuf(plaintext),
  );
  return new Uint8Array(out);
}

export async function aesGcmDecrypt(
  key: CryptoKey,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  try {
    const out = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asBuf(nonce), additionalData: asBuf(aad) },
      key,
      asBuf(ciphertext),
    );
    return new Uint8Array(out);
  } catch {
    // GCM tag mismatch — fail closed. Do not leak which of key/ciphertext/aad.
    throw new WrongPassphraseError("AES-GCM authentication failed — wrong passphrase or corrupted ciphertext");
  }
}
