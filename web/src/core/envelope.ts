// The Blink-Drop file envelope (docs/01-protocol.md §4, §7, §8, §9).
//
//   original file  --gzip-->  payload
//   message = dCBOR [ header, payload ]
//   header  = { 1:name, 2:media_type, 3:orig_size, 4:sha256(original), 5:compression }
//
// buildMessage produces the message bytes that UR/MUR transports; openMessage
// reverses it and applies the two mandatory gates: the bounded decompression
// (SG-2) and the SHA-256 file-acceptance check (SG-1). Nothing is returned to a
// caller unless the digest matches.

import { type CborMap, type CborValue, decode as cborDecode, encode as cborEncode } from "./cbor";
import { bytesEqual, sha256 } from "./digest";
import { gunzip, gzip } from "./gzip";
import {
  Compression,
  type CompressionValue,
  type DecodedFile,
  type FileInput,
  HARD_MAX_DECOMPRESSED_BYTES,
  type Header,
  HeaderKey,
  SHA256_BYTES,
} from "./types";

export class MalformedMessageError extends Error {
  override name = "MalformedMessageError";
}
export class DigestMismatchError extends Error {
  override name = "DigestMismatchError";
}

export async function buildMessage(input: FileInput): Promise<Uint8Array> {
  const digest = await sha256(input.bytes);
  const compressed = await gzip(input.bytes);

  // Store uncompressed when gzip does not actually shrink it (protocol §8).
  const useGzip = compressed.length < input.bytes.length;
  const payload = useGzip ? compressed : input.bytes;
  const compression: CompressionValue = useGzip ? Compression.gzip : Compression.none;

  const header: CborMap = new Map<number, CborValue>([
    [HeaderKey.name, input.name],
    [HeaderKey.mediaType, input.mediaType],
    [HeaderKey.origSize, input.bytes.length],
    [HeaderKey.sha256, digest],
    [HeaderKey.compression, compression],
  ]);

  return cborEncode([header, payload]);
}

export function parseMessage(message: Uint8Array): { header: Header; payload: Uint8Array } {
  let decoded: CborValue;
  try {
    decoded = cborDecode(message);
  } catch (e) {
    throw new MalformedMessageError(`message is not valid CBOR: ${(e as Error).message}`);
  }
  if (!Array.isArray(decoded) || decoded.length !== 2) {
    throw new MalformedMessageError("message must be a 2-element CBOR array [header, payload]");
  }
  const [rawHeader, payload] = decoded;
  if (!(rawHeader instanceof Map)) throw new MalformedMessageError("header must be a CBOR map");
  if (!(payload instanceof Uint8Array)) throw new MalformedMessageError("payload must be a CBOR byte string");

  const header = readHeader(rawHeader);
  return { header, payload };
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

export async function openMessage(message: Uint8Array): Promise<DecodedFile> {
  const { header, payload } = parseMessage(message);

  const cap = Math.min(header.origSize, HARD_MAX_DECOMPRESSED_BYTES);
  let bytes: Uint8Array;
  if (header.compression === Compression.gzip) {
    bytes = await gunzip(payload, cap);
  } else {
    if (payload.length > HARD_MAX_DECOMPRESSED_BYTES)
      throw new MalformedMessageError("stored payload exceeds hard ceiling");
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
