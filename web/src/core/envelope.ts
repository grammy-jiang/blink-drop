// The Blink-Drop file envelope (docs/01-protocol.md §4, §7, §8, §9; encryption
// in docs/07 §4).
//
//   PLAINTEXT (default, unchanged wire format):
//     original file --gzip--> payload
//     message = dCBOR [ header, payload ]
//     header  = { 1:name, 2:media_type, 3:orig_size, 4:sha256(original), 5:compression }
//
//   ENCRYPTED (opt-in, when a passphrase is supplied):
//     inner   = dCBOR [ meta, payload ]            ; meta = the header above
//     message = dCBOR [ outer, ciphertext ]        ; ciphertext = AES-256-GCM(inner)
//     outer   = { 0:version, 6:{ kdf,iter,salt,cipher,nonce } }   ; cleartext, AAD-bound
//
// compress-then-encrypt: gzip runs first (ciphertext is incompressible), and the
// metadata rides INSIDE the ciphertext so name/type/size/hash no longer leak.
// buildMessage produces the message bytes UR/MUR transports; openMessage reverses
// it and applies the mandatory gates — bounded decompression (SG-2) and the
// SHA-256 file-acceptance check (SG-1) — to both paths. Nothing is returned to a
// caller unless the digest matches.

import { type CborMap, type CborValue, decode as cborDecode, encode as cborEncode } from "./cbor";
import { type Argon2Params, aesGcmDecrypt, aesGcmEncrypt, deriveKey, deriveKeyArgon2, randomBytes } from "./crypto";
import { bytesEqual, sha256 } from "./digest";
import { gunzip, gzip } from "./gzip";
import {
  ARGON2_DEFAULTS,
  ArgonKey,
  CIPHER_AES_256_GCM,
  Compression,
  type CompressionValue,
  type DecodedFile,
  ENVELOPE_VERSION_ENCRYPTED,
  ENVELOPE_VERSION_MULTIFILE,
  EncKey,
  type FileInput,
  GCM_NONCE_BYTES,
  HARD_MAX_DECOMPRESSED_BYTES,
  type Header,
  HeaderKey,
  KDF_ARGON2ID,
  KDF_PBKDF2_SHA256,
  MAX_ARGON2,
  MAX_FILE_COUNT,
  MAX_PBKDF2_ITERATIONS,
  MAX_TOTAL_DECOMPRESSED_BYTES,
  OuterKey,
  PBKDF2_ITERATIONS,
  SALT_BYTES,
  SHA256_BYTES,
} from "./types";

export class MalformedMessageError extends Error {
  override name = "MalformedMessageError";
}
export class DigestMismatchError extends Error {
  override name = "DigestMismatchError";
}
// The message is encrypted but no passphrase was supplied. Distinct from
// WrongPassphraseError (a supplied passphrase that failed the AEAD tag) so the
// receiver can prompt rather than show a failure.
export class PassphraseRequiredError extends Error {
  override name = "PassphraseRequiredError";
}

export interface OpenOptions {
  passphrase?: string;
}

export interface BuildOptions {
  // Supplying a passphrase produces the encrypted envelope; omitting it keeps
  // the plaintext wire format byte-for-byte.
  passphrase?: string;
  // KDF selection (default "pbkdf2-sha256"). "argon2id" is the opt-in memory-hard
  // KDF; it lazily loads a wasm module (docs/09).
  kdf?: typeof KDF_PBKDF2_SHA256 | typeof KDF_ARGON2ID;
  // Deterministic overrides — for test vectors ONLY. Production always uses a
  // fresh CSPRNG salt/nonce and the default work factors.
  salt?: Uint8Array;
  nonce?: Uint8Array;
  iterations?: number; // pbkdf2 work factor
  argon?: Argon2Params; // argon2id cost params
}

// One file's [meta, payload] pair — the single-file message body, reused as each
// entry of a multi-file message.
async function buildFileBody(input: FileInput): Promise<[CborMap, Uint8Array]> {
  const digest = await sha256(input.bytes);
  const compressed = await gzip(input.bytes);
  // Store uncompressed when gzip does not actually shrink it (protocol §8).
  const useGzip = compressed.length < input.bytes.length;
  const payload = useGzip ? compressed : input.bytes;
  const compression: CompressionValue = useGzip ? Compression.gzip : Compression.none;
  const meta: CborMap = new Map<number, CborValue>([
    [HeaderKey.name, input.name],
    [HeaderKey.mediaType, input.mediaType],
    [HeaderKey.origSize, input.bytes.length],
    [HeaderKey.sha256, digest],
    [HeaderKey.compression, compression],
  ]);
  return [meta, payload];
}

// Seal an inner message (single [meta,payload] or multi [manifest,[…]]) under a
// passphrase-derived key → the encrypted envelope [outer, ciphertext]. The inner
// shape is opaque to this — encryption wraps single and multi-file identically.
async function encryptInner(inner: Uint8Array, opts: BuildOptions): Promise<Uint8Array> {
  const salt = opts.salt ?? randomBytes(SALT_BYTES);
  const nonce = opts.nonce ?? randomBytes(GCM_NONCE_BYTES);
  const passphrase = opts.passphrase as string;

  let outer: CborMap;
  let key: CryptoKey;
  if ((opts.kdf ?? KDF_PBKDF2_SHA256) === KDF_ARGON2ID) {
    const argon = opts.argon ?? ARGON2_DEFAULTS;
    outer = buildOuterArgon2(salt, nonce, argon);
    key = await deriveKeyArgon2(passphrase, salt, argon);
  } else {
    const iterations = opts.iterations ?? PBKDF2_ITERATIONS;
    outer = buildOuterPbkdf2(salt, nonce, iterations);
    key = await deriveKey(passphrase, salt, iterations);
  }

  const aad = cborEncode(outer); // deterministic (canonical CBOR) → reproducible on decrypt
  const ciphertext = await aesGcmEncrypt(key, nonce, inner, aad);
  return cborEncode([outer, ciphertext]);
}

export async function buildMessage(input: FileInput, opts: BuildOptions = {}): Promise<Uint8Array> {
  const [meta, payload] = await buildFileBody(input);
  const inner = cborEncode([meta, payload]);
  return opts.passphrase ? encryptInner(inner, opts) : inner;
}

// Multi-file (protocol §4.2, docs/13): 1 input → the single-file envelope
// (byte-for-byte unchanged); ≥ 2 → [ manifest{0:2}, [ [meta,payload]… ] ].
// Encryption wraps the whole set (and hides the individual file names).
export async function buildFilesMessage(inputs: FileInput[], opts: BuildOptions = {}): Promise<Uint8Array> {
  if (inputs.length === 0) throw new Error("buildFilesMessage requires at least one file");
  if (inputs.length === 1) return buildMessage(inputs[0]!, opts);
  if (inputs.length > MAX_FILE_COUNT) throw new Error(`too many files (max ${MAX_FILE_COUNT})`);

  const bodies = await Promise.all(inputs.map(buildFileBody));
  const manifest: CborMap = new Map<number, CborValue>([[OuterKey.version, ENVELOPE_VERSION_MULTIFILE]]);
  const inner = cborEncode([manifest, bodies.map(([meta, payload]) => [meta, payload] as CborValue)]);
  return opts.passphrase ? encryptInner(inner, opts) : inner;
}

function buildOuter(enc: CborMap): CborMap {
  return new Map<number, CborValue>([
    [OuterKey.version, ENVELOPE_VERSION_ENCRYPTED],
    [OuterKey.enc, enc],
  ]);
}

function buildOuterPbkdf2(salt: Uint8Array, nonce: Uint8Array, iterations: number): CborMap {
  return buildOuter(
    new Map<number, CborValue>([
      [EncKey.kdf, KDF_PBKDF2_SHA256],
      [EncKey.iter, iterations],
      [EncKey.salt, salt],
      [EncKey.cipher, CIPHER_AES_256_GCM],
      [EncKey.nonce, nonce],
    ]),
  );
}

function buildOuterArgon2(salt: Uint8Array, nonce: Uint8Array, argon: Argon2Params): CborMap {
  const argonParams: CborMap = new Map<number, CborValue>([
    [ArgonKey.m, argon.m],
    [ArgonKey.t, argon.t],
    [ArgonKey.p, argon.p],
  ]);
  return buildOuter(
    new Map<number, CborValue>([
      [EncKey.kdf, KDF_ARGON2ID],
      [EncKey.iter, argonParams], // key 2 holds the argon params sub-map
      [EncKey.salt, salt],
      [EncKey.cipher, CIPHER_AES_256_GCM],
      [EncKey.nonce, nonce],
    ]),
  );
}

// Decode the top-level [map, bytes] shape shared by both message kinds.
function decodeMessageArray(message: Uint8Array): [CborMap, Uint8Array] {
  let decoded: CborValue;
  try {
    decoded = cborDecode(message);
  } catch (e) {
    throw new MalformedMessageError(`message is not valid CBOR: ${(e as Error).message}`);
  }
  if (!Array.isArray(decoded) || decoded.length !== 2) {
    throw new MalformedMessageError("message must be a 2-element CBOR array");
  }
  const [first, second] = decoded;
  if (!(first instanceof Map)) throw new MalformedMessageError("first message element must be a CBOR map");
  if (!(second instanceof Uint8Array))
    throw new MalformedMessageError("second message element must be a CBOR byte string");
  return [first, second];
}

// Loose top-level decode: [ map, X ] where X is bytes (single / encrypted) OR an
// array (the multi-file payload list). The caller dispatches on the map's key 0.
function decodeBodyArray(bytes: Uint8Array): [CborMap, CborValue] {
  let decoded: CborValue;
  try {
    decoded = cborDecode(bytes);
  } catch (e) {
    throw new MalformedMessageError(`message is not valid CBOR: ${(e as Error).message}`);
  }
  if (!Array.isArray(decoded) || decoded.length !== 2) {
    throw new MalformedMessageError("message must be a 2-element CBOR array");
  }
  const [first, second] = decoded;
  if (!(first instanceof Map)) throw new MalformedMessageError("first message element must be a CBOR map");
  return [first, second as CborValue]; // length === 2 checked above → defined
}

// True when the message is an encrypted envelope. Lets the receiver prompt for a
// passphrase before attempting to open it. Never throws.
export function isEncryptedMessage(message: Uint8Array): boolean {
  try {
    const [first] = decodeMessageArray(message);
    return first.get(OuterKey.version) !== undefined;
  } catch {
    return false;
  }
}

// Plaintext-only parse (kept for the plaintext wire contract / tests). Rejects an
// encrypted message — use openMessage with a passphrase for those.
export function parseMessage(message: Uint8Array): { header: Header; payload: Uint8Array } {
  const [first, payload] = decodeMessageArray(message);
  if (first.get(OuterKey.version) !== undefined) {
    throw new MalformedMessageError("message is encrypted; open it with a passphrase");
  }
  return { header: readHeader(first), payload };
}

function readHeader(map: CborMap): Header {
  const name = expect(map, HeaderKey.name, "string", "name");
  const mediaType = expect(map, HeaderKey.mediaType, "string", "media_type");
  const origSize = expect(map, HeaderKey.origSize, "number", "orig_size");
  const sha = expect(map, HeaderKey.sha256, "bytes", "sha256");
  const compression = expect(map, HeaderKey.compression, "number", "compression");

  if (sha.length !== SHA256_BYTES) throw new MalformedMessageError(`sha256 must be ${SHA256_BYTES} bytes`);
  if (compression !== Compression.none && compression !== Compression.gzip) {
    throw new MalformedMessageError(`unknown compression value ${compression}`);
  }
  return { name, mediaType, origSize, sha256: sha, compression };
}

type Kind = "string" | "number" | "bytes";
type KindResult<K extends Kind> = K extends "string" ? string : K extends "number" ? number : Uint8Array;

function expect<K extends Kind>(map: CborMap, key: number, kind: K, label: string): KindResult<K> {
  const v = map.get(key);
  if (v === undefined) throw new MalformedMessageError(`header missing ${label}`);
  if (kind === "string" && typeof v === "string") return v as KindResult<K>;
  if (kind === "number" && typeof v === "number") return v as KindResult<K>;
  if (kind === "bytes" && v instanceof Uint8Array) return v as KindResult<K>;
  throw new MalformedMessageError(`header field ${label} has the wrong type`);
}

// Decrypt an encrypted envelope → the inner MESSAGE BYTES (single or multi-file;
// the shape is decided by the caller). Throws PassphraseRequiredError when none
// was supplied, and WrongPassphraseError (from crypto.ts) when the AEAD tag fails.
async function decryptInner(
  outer: CborMap,
  ciphertext: Uint8Array,
  passphrase: string | undefined,
): Promise<Uint8Array> {
  if (passphrase === undefined || passphrase === "") {
    throw new PassphraseRequiredError("this transfer is encrypted; a passphrase is required");
  }
  if (outer.get(OuterKey.version) !== ENVELOPE_VERSION_ENCRYPTED) {
    throw new MalformedMessageError(`unsupported envelope version ${String(outer.get(OuterKey.version))}`);
  }
  const params = outer.get(OuterKey.enc);
  if (!(params instanceof Map)) throw new MalformedMessageError("encrypted envelope missing enc params");

  const cipher = params.get(EncKey.cipher);
  const salt = params.get(EncKey.salt);
  const nonce = params.get(EncKey.nonce);
  if (cipher !== CIPHER_AES_256_GCM) throw new MalformedMessageError(`unsupported cipher ${String(cipher)}`);
  if (!(salt instanceof Uint8Array) || salt.length !== SALT_BYTES) throw new MalformedMessageError("invalid kdf salt");
  if (!(nonce instanceof Uint8Array) || nonce.length !== GCM_NONCE_BYTES)
    throw new MalformedMessageError("invalid nonce");

  const key = await deriveKeyForKdf(params.get(EncKey.kdf), params.get(EncKey.iter), passphrase, salt);
  const aad = cborEncode(outer);
  return aesGcmDecrypt(key, nonce, ciphertext, aad); // WrongPassphraseError on tag failure
}

// A single-file body `[meta, payload]` → header + payload. Rejects a multi-file
// body — a caller on the single-file API must switch to openFilesMessage.
function readSingleBody(first: CborMap, second: CborValue): { header: Header; payload: Uint8Array } {
  if (first.get(OuterKey.version) === ENVELOPE_VERSION_MULTIFILE) {
    throw new MalformedMessageError("multi-file message; use openFilesMessage");
  }
  if (!(second instanceof Uint8Array)) throw new MalformedMessageError("payload must be a CBOR byte string");
  return { header: readHeader(first), payload: second };
}

// A plain integer within [min, max]. The CBOR decoder only emits non-negative
// integers, so this is primarily a bound (with defense-in-depth vs degenerate
// values). Used to reject a hostile KDF cost factor (KDF bomb).
function boundedInt(v: CborValue | undefined, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

// Derive the AES key for whichever KDF the envelope names. `work` is EncKey.iter:
// a uint (PBKDF2 iterations) or an { m, t, p } map (Argon2id cost params). An
// unknown kdf fails closed — a build without Argon2 support never mis-accepts.
async function deriveKeyForKdf(
  kdf: CborValue | undefined,
  work: CborValue | undefined,
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  if (kdf === KDF_PBKDF2_SHA256) {
    // Bounded: an unbounded iteration count is a KDF bomb — derivation runs
    // (unconditionally) BEFORE the AEAD tag check, so a huge count DoSes here.
    if (!boundedInt(work, 1, MAX_PBKDF2_ITERATIONS)) {
      throw new MalformedMessageError("invalid or excessive PBKDF2 iterations");
    }
    return deriveKey(passphrase, salt, work);
  }
  if (kdf === KDF_ARGON2ID) {
    if (!(work instanceof Map)) throw new MalformedMessageError("invalid argon2 params");
    const m = work.get(ArgonKey.m);
    const t = work.get(ArgonKey.t);
    const p = work.get(ArgonKey.p);
    if (!boundedInt(m, 1, MAX_ARGON2.m) || !boundedInt(t, 1, MAX_ARGON2.t) || !boundedInt(p, 1, MAX_ARGON2.p)) {
      throw new MalformedMessageError("invalid or excessive argon2 params");
    }
    return deriveKeyArgon2(passphrase, salt, { m, t, p });
  }
  throw new MalformedMessageError(`unsupported kdf ${String(kdf)}`);
}

export async function openMessage(message: Uint8Array, opts: OpenOptions = {}): Promise<DecodedFile> {
  const [first, second] = decodeBodyArray(message);
  if (first.get(OuterKey.version) === ENVELOPE_VERSION_ENCRYPTED) {
    if (!(second instanceof Uint8Array)) throw new MalformedMessageError("ciphertext must be a CBOR byte string");
    const inner = await decryptInner(first, second, opts.passphrase);
    const [f, s] = decodeBodyArray(inner);
    const body = readSingleBody(f, s);
    return finishOpen(body.header, body.payload);
  }
  const body = readSingleBody(first, second);
  return finishOpen(body.header, body.payload);
}

// Multi-file-aware open: returns ALL files (single → length 1, multi → N), each
// SHA-256-verified, with a per-file bomb bound + a total-decompressed cap.
export async function openFilesMessage(message: Uint8Array, opts: OpenOptions = {}): Promise<DecodedFile[]> {
  const [first, second] = decodeBodyArray(message);
  if (first.get(OuterKey.version) === ENVELOPE_VERSION_ENCRYPTED) {
    if (!(second instanceof Uint8Array)) throw new MalformedMessageError("ciphertext must be a CBOR byte string");
    const inner = await decryptInner(first, second, opts.passphrase);
    return decodeFilesFromBody(inner);
  }
  return decodeFilesFromBody(message);
}

// Dispatch a (decrypted) body to one or more verified files.
async function decodeFilesFromBody(bytes: Uint8Array): Promise<DecodedFile[]> {
  const [first, second] = decodeBodyArray(bytes);
  if (first.get(OuterKey.version) === ENVELOPE_VERSION_MULTIFILE) {
    if (!Array.isArray(second)) throw new MalformedMessageError("multi-file body must be a payload list");
    if (second.length < 1 || second.length > MAX_FILE_COUNT) {
      throw new MalformedMessageError("invalid multi-file count");
    }
    const files: DecodedFile[] = [];
    let total = 0;
    for (const entry of second) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        throw new MalformedMessageError("multi-file entry must be a 2-element [meta, payload]");
      }
      const [metaMap, payload] = entry;
      if (!(metaMap instanceof Map)) throw new MalformedMessageError("multi-file meta must be a CBOR map");
      if (!(payload instanceof Uint8Array)) throw new MalformedMessageError("multi-file payload must be a byte string");
      const header = readHeader(metaMap);
      total += header.origSize;
      if (total > MAX_TOTAL_DECOMPRESSED_BYTES) {
        throw new MalformedMessageError("multi-file total exceeds the hard ceiling");
      }
      files.push(await finishOpen(header, payload));
    }
    return files;
  }
  const single = readSingleBody(first, second);
  return [await finishOpen(single.header, single.payload)];
}

// The two mandatory gates, shared by the plaintext and decrypted paths: bounded
// decompression (SG-2) then the SHA-256 file-acceptance check (SG-1).
async function finishOpen(header: Header, payload: Uint8Array): Promise<DecodedFile> {
  const cap = Math.min(header.origSize, HARD_MAX_DECOMPRESSED_BYTES);
  let bytes: Uint8Array;
  if (header.compression === Compression.gzip) {
    bytes = await gunzip(payload, cap);
  } else {
    if (payload.length > HARD_MAX_DECOMPRESSED_BYTES) {
      throw new MalformedMessageError("stored payload exceeds hard ceiling");
    }
    bytes = payload;
  }

  if (bytes.length !== header.origSize) {
    throw new MalformedMessageError(`decompressed size ${bytes.length} != declared orig_size ${header.origSize}`);
  }

  const digest = await sha256(bytes);
  if (!bytesEqual(digest, header.sha256)) {
    throw new DigestMismatchError("reconstructed file does not match the declared SHA-256");
  }
  return { header, bytes };
}
