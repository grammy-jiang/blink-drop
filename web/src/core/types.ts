// Protocol constants and shapes (docs/01-protocol.md §4-§6).

export const UR_TYPE = "blink-drop";

// dCBOR header map keys (protocol §4). In an encrypted envelope these same keys
// form the INNER metadata map (sealed inside the ciphertext, docs/07 §4).
export const HeaderKey = {
  name: 1,
  mediaType: 2,
  origSize: 3,
  sha256: 4,
  compression: 5,
} as const;

// Encrypted-envelope keys (docs/07 §4). The cleartext OUTER map carries only a
// version marker + the enc-params map; key 0 (absent in a plaintext header)
// discriminates encrypted from plaintext messages.
export const OuterKey = {
  version: 0,
  enc: 6,
} as const;

// Keys inside the enc-params map (OuterKey.enc).
export const EncKey = {
  kdf: 1,
  iter: 2,
  salt: 3,
  cipher: 4,
  nonce: 5,
} as const;

export const ENVELOPE_VERSION_ENCRYPTED = 1;
export const KDF_PBKDF2_SHA256 = "pbkdf2-sha256";
export const KDF_ARGON2ID = "argon2id"; // opt-in memory-hard KDF (v0.4)
export const CIPHER_AES_256_GCM = "aes-256-gcm";

// PBKDF2 work factor (OWASP-2023 floor for PBKDF2-SHA256). Runs once per
// transfer per side; well under a second on a phone. Tests/vectors override it
// with a small count for speed — production uses this default.
export const PBKDF2_ITERATIONS = 600_000;

// Argon2id cost params. When kdf = argon2id, EncKey.iter (key 2) holds a sub-map
// { m, t, p } instead of a plain iteration count.
export const ArgonKey = { m: 1, t: 2, p: 3 } as const; // memory (KiB), time, parallelism
export const ARGON2_DEFAULTS = { m: 19456, t: 2, p: 1 } as const; // OWASP: 19 MiB, t=2, p=1

export const SALT_BYTES = 16; // 128-bit KDF salt
export const GCM_NONCE_BYTES = 12; // 96-bit AES-GCM nonce
export const KDF_KEY_BYTES = 32; // derived AES-256 key length

export const Compression = {
  none: 0,
  gzip: 1,
} as const;
export type CompressionValue = (typeof Compression)[keyof typeof Compression];

export interface Header {
  name: string;
  mediaType: string;
  origSize: number;
  sha256: Uint8Array; // 32 bytes, SHA-256 of the ORIGINAL (uncompressed) file
  compression: CompressionValue;
}

export interface FileInput {
  bytes: Uint8Array;
  name: string;
  mediaType: string;
}

export interface DecodedFile {
  header: Header;
  bytes: Uint8Array; // original, verified against header.sha256
}

// Seed defaults (protocol §6) — tuned later by the sweep harness (roadmap M3).
export const DEFAULT_MAX_FRAGMENT_LENGTH = 600; // bytes per UR fragment (~symbol v20)

// Hard decompression ceiling (protocol §9, SG-2) — independent of header.origSize.
export const HARD_MAX_DECOMPRESSED_BYTES = 8 * 1024 * 1024;

export const SHA256_BYTES = 32;
