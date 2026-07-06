// Protocol constants and shapes (docs/01-protocol.md §4-§6).

export const UR_TYPE = "blink-drop";

// dCBOR header map keys (protocol §4).
export const HeaderKey = {
  name: 1,
  mediaType: 2,
  origSize: 3,
  sha256: 4,
  compression: 5,
} as const;

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
