// UR / Multipart-UR transport (docs/01-protocol.md §5, §6) via @ngraveio/bc-ur.
//
// bc-ur owns the hard part: fountain partitioning, part framing, cross-part
// binding (CRC-32), and reassembly. Blink-Drop only wraps its own message bytes
// with the custom `blink-drop` UR type and applies the QR case rule.
//
// Note: bc-ur uses node Buffer. In node (tests) it is a global; the browser
// build supplies a Buffer polyfill (see the build config for the sender/receiver
// UI). This module is the only place that touches bc-ur.

import { UR, URDecoder, UREncoder } from "@ngraveio/bc-ur";
import { DEFAULT_MAX_FRAGMENT_LENGTH, MAX_SEQ_LEN, UR_TYPE } from "./types";

function toBuffer(u: Uint8Array): Buffer {
  return Buffer.from(u.buffer, u.byteOffset, u.byteLength);
}

// Wrap message bytes as a `blink-drop`-typed UR. UR.fromBuffer CBOR-wraps the
// bytes (type `bytes`); we re-tag the identical payload with our custom type
// using only the public API.
export function makeEncoder(message: Uint8Array, maxFragmentLength: number = DEFAULT_MAX_FRAGMENT_LENGTH): UREncoder {
  const inner = UR.fromBuffer(toBuffer(message));
  const ur = new UR(inner.cbor, UR_TYPE);
  return new UREncoder(ur, maxFragmentLength);
}

// QR alphanumeric mode is uppercase-only, so the QR carries the UPPERCASED UR
// string (protocol §6). Systematic parts are the finite base set (seqLen of them).
export function systematicQrParts(
  message: Uint8Array,
  maxFragmentLength: number = DEFAULT_MAX_FRAGMENT_LENGTH,
): string[] {
  return makeEncoder(message, maxFragmentLength)
    .encodeWhole()
    .map((p) => p.toUpperCase());
}

// A stream of `count` parts (systematic first, then endless fountain mixes),
// uppercased. Used to exercise loss/subset behaviour.
export function qrPartStream(
  message: Uint8Array,
  count: number,
  maxFragmentLength: number = DEFAULT_MAX_FRAGMENT_LENGTH,
): string[] {
  const encoder = makeEncoder(message, maxFragmentLength);
  const parts: string[] = [];
  for (let i = 0; i < count; i++) parts.push(encoder.nextPart().toUpperCase());
  return parts;
}

// Collects QR parts (any order, with loss/duplication) until the message is
// reconstructed. bc-ur handles dedupe, session binding, and fountain solving.
export class Assembler {
  private readonly decoder = new URDecoder();

  // The MUR sequence component: `ur:<type>/<seqNum>-<seqLen>/<bytewords>`.
  // (A single-part UR has no sequence component and won't match.)
  private static readonly SEQ = /^ur:[^/]+\/\d+-(\d+)\//i;

  // Returns true if the part was accepted (well-formed and for this session).
  receiveQr(qrPart: string): boolean {
    // Reject an absurd declared part count BEFORE bc-ur does `new Array(seqLen)`
    // on the first part — a single crafted frame otherwise OOMs the receiver
    // (SG-2-class resource-exhaustion DoS).
    const seq = Assembler.SEQ.exec(qrPart);
    if (seq && Number(seq[1]) > MAX_SEQ_LEN) return false;
    try {
      return this.decoder.receivePart(qrPart.toLowerCase());
    } catch {
      // bc-ur throws (InvalidSchemeError / internal assertion) on a malformed
      // part rather than returning false. A garbled or hostile QR frame must be
      // DROPPED, not crash the scan loop — the camera feeds arbitrary decoded
      // QR strings here. (Regression: web/test/fuzz.test.ts.)
      return false;
    }
  }

  get isComplete(): boolean {
    return this.decoder.isComplete();
  }

  get isSuccess(): boolean {
    return this.decoder.isSuccess();
  }

  // Real progress denominator (protocol §5, R-SELFDESC).
  get percentComplete(): number {
    return this.decoder.estimatedPercentComplete();
  }

  get expectedPartCount(): number {
    return this.decoder.expectedPartCount();
  }

  message(): Uint8Array {
    if (!this.decoder.isSuccess()) throw new Error("assembler is not complete");
    return new Uint8Array(this.decoder.resultUR().decodeCBOR());
  }
}
