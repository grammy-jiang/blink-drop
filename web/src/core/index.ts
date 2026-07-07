// Blink-Drop protocol core (docs/01-protocol.md). Pure, isomorphic, and the
// piece bound to shared/test-vectors. The M0 browser receiver reuses this
// unchanged (the decode path); the iOS receiver mirrors it in Swift.

export type { CborMap, CborValue } from "./cbor";
export { CborError, decode as cborDecode, encode as cborEncode } from "./cbor";
export {
  type Argon2Params,
  aesGcmDecrypt,
  aesGcmEncrypt,
  deriveKey,
  deriveKeyArgon2,
  randomBytes,
  WrongPassphraseError,
} from "./crypto";
export { bytesEqual, sha256 } from "./digest";
export {
  type BuildOptions,
  buildFilesMessage,
  buildMessage,
  DigestMismatchError,
  isEncryptedMessage,
  MalformedMessageError,
  type OpenOptions,
  openFilesMessage,
  openMessage,
  PassphraseRequiredError,
  parseMessage,
} from "./envelope";
export { DecompressionOverflowError, gunzip, gzip } from "./gzip";
export * from "./types";
export { Assembler, makeEncoder, qrPartStream, systematicQrParts } from "./ur";

import {
  type BuildOptions,
  buildFilesMessage,
  buildMessage,
  type OpenOptions,
  openFilesMessage,
  openMessage,
} from "./envelope";
import { DEFAULT_MAX_FRAGMENT_LENGTH, type DecodedFile, type FileInput } from "./types";
import { Assembler, systematicQrParts } from "./ur";

// Sender: file -> the finite set of QR part strings (systematic parts). The
// player loops these and interleaves fountain parts (qrPartStream) as needed.
// Pass a passphrase in `opts` to produce an encrypted stream (docs/07).
export async function encodeFileToQrParts(
  input: FileInput,
  maxFragmentLength: number = DEFAULT_MAX_FRAGMENT_LENGTH,
  opts: BuildOptions = {},
): Promise<string[]> {
  const message = await buildMessage(input, opts);
  return systematicQrParts(message, maxFragmentLength);
}

// Receiver: feed captured QR strings until reconstruction, then verify and open.
// Throws on incomplete input, digest mismatch (SG-1), a decompression bomb
// (SG-2), or — for an encrypted stream — a missing/wrong passphrase.
export async function decodeQrPartsToFile(qrParts: Iterable<string>, opts: OpenOptions = {}): Promise<DecodedFile> {
  const assembler = new Assembler();
  for (const part of qrParts) {
    assembler.receiveQr(part);
    if (assembler.isComplete) break;
  }
  if (!assembler.isSuccess) throw new Error("QR parts did not reconstruct a complete message");
  return openMessage(assembler.message(), opts);
}

// Multi-file variants (docs/13). encodeFilesToQrParts takes N files (1 file is
// byte-identical to encodeFileToQrParts). decodeQrPartsToFiles returns every file.
export async function encodeFilesToQrParts(
  inputs: FileInput[],
  maxFragmentLength: number = DEFAULT_MAX_FRAGMENT_LENGTH,
  opts: BuildOptions = {},
): Promise<string[]> {
  const message = await buildFilesMessage(inputs, opts);
  return systematicQrParts(message, maxFragmentLength);
}

export async function decodeQrPartsToFiles(qrParts: Iterable<string>, opts: OpenOptions = {}): Promise<DecodedFile[]> {
  const assembler = new Assembler();
  for (const part of qrParts) {
    assembler.receiveQr(part);
    if (assembler.isComplete) break;
  }
  if (!assembler.isSuccess) throw new Error("QR parts did not reconstruct a complete message");
  return openFilesMessage(assembler.message(), opts);
}
