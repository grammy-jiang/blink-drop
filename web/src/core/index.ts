// Blink-Drop protocol core (docs/01-protocol.md). Pure, isomorphic, and the
// piece bound to shared/test-vectors. The M0 browser receiver reuses this
// unchanged (the decode path); the iOS receiver mirrors it in Swift.

export type { CborMap, CborValue } from "./cbor";
export { CborError, decode as cborDecode, encode as cborEncode } from "./cbor";
export { bytesEqual, sha256 } from "./digest";
export { buildMessage, DigestMismatchError, MalformedMessageError, openMessage, parseMessage } from "./envelope";
export { DecompressionOverflowError, gunzip, gzip } from "./gzip";
export * from "./types";
export { Assembler, makeEncoder, qrPartStream, systematicQrParts } from "./ur";

import { buildMessage, openMessage } from "./envelope";
import { DEFAULT_MAX_FRAGMENT_LENGTH, type DecodedFile, type FileInput } from "./types";
import { Assembler, systematicQrParts } from "./ur";

// Sender: file -> the finite set of QR part strings (systematic parts). The
// player loops these and interleaves fountain parts (qrPartStream) as needed.
export async function encodeFileToQrParts(
  input: FileInput,
  maxFragmentLength: number = DEFAULT_MAX_FRAGMENT_LENGTH,
): Promise<string[]> {
  const message = await buildMessage(input);
  return systematicQrParts(message, maxFragmentLength);
}

// Receiver: feed captured QR strings until reconstruction, then verify and open.
// Throws on incomplete input, digest mismatch (SG-1), or a decompression bomb (SG-2).
export async function decodeQrPartsToFile(qrParts: Iterable<string>): Promise<DecodedFile> {
  const assembler = new Assembler();
  for (const part of qrParts) {
    assembler.receiveQr(part);
    if (assembler.isComplete) break;
  }
  if (!assembler.isSuccess) throw new Error("QR parts did not reconstruct a complete message");
  return openMessage(assembler.message());
}
