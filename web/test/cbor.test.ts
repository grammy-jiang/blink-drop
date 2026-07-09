import { describe, expect, test } from "vitest";
import { CborError, type CborValue, cborDecode as decode, cborEncode as encode } from "../src/core/index.js";

// Direct encode/decode tests for the deterministic CBOR subset (src/core/cbor.ts).
// The envelope exercises it indirectly; this pins the wire contract itself — the
// integer head-length boundaries, canonical ordering, and every malformed-input
// rejection — which is where the Stryker survivors were.

const roundtrip = (v: CborValue): CborValue => decode(encode(v));

describe("cbor round-trip", () => {
  test("unsigned integers across every head-length boundary + byte position", () => {
    // Spans the 1 / 2 / 3 / 5 / 9-byte head encodings, with distinct non-zero
    // bytes so any flipped shift/±/÷ in the (de)serializer changes the value.
    for (const n of [
      0,
      1,
      23,
      24,
      25,
      255,
      256,
      257,
      65535,
      65536,
      65537,
      0x01020304,
      0xffffffff,
      0x100000000,
      0x0007060504030201,
      Number.MAX_SAFE_INTEGER,
    ]) {
      expect(roundtrip(n)).toBe(n);
    }
  });

  test("text / byte-string / array / map (incl. empty) round-trip", () => {
    expect(roundtrip("héllo ⚡ world")).toBe("héllo ⚡ world");
    expect(roundtrip("")).toBe("");
    const bytes = new Uint8Array([0, 1, 2, 254, 255]);
    expect(roundtrip(bytes)).toEqual(bytes);
    expect(roundtrip(new Uint8Array(0))).toEqual(new Uint8Array(0));
    expect(roundtrip([1, "two", new Uint8Array([3]), [4]])).toEqual([1, "two", new Uint8Array([3]), [4]]);
    expect(roundtrip([])).toEqual([]);
    const m = new Map<number, CborValue>([
      [2, "b"],
      [1, "a"],
    ]);
    expect(roundtrip(m)).toEqual(m);
  });

  test("map keys serialize in ascending (canonical) order regardless of insertion", () => {
    const shuffled = encode(
      new Map<number, CborValue>([
        [3, "c"],
        [1, "a"],
        [2, "b"],
      ]),
    );
    const sorted = encode(
      new Map<number, CborValue>([
        [1, "a"],
        [2, "b"],
        [3, "c"],
      ]),
    );
    expect(shuffled).toEqual(sorted);
  });
});

describe("cbor encode rejects unsupported inputs", () => {
  test("negative, fractional, or too-large integers throw", () => {
    expect(() => encode(-1)).toThrow(CborError);
    expect(() => encode(1.5)).toThrow(CborError);
    expect(() => encode(Number.MAX_SAFE_INTEGER + 1)).toThrow(CborError);
  });

  test("unsupported value types + non-uint map keys throw", () => {
    expect(() => encode(null as unknown as CborValue)).toThrow(CborError);
    expect(() => encode(true as unknown as CborValue)).toThrow(CborError);
    expect(() => encode({ a: 1 } as unknown as CborValue)).toThrow(CborError);
    expect(() => encode(new Map([["a" as unknown as number, 1]]))).toThrow(CborError);
  });
});

describe("cbor decode rejects malformed bytes", () => {
  test("trailing bytes after a complete value", () => {
    expect(() => decode(new Uint8Array([...encode(1), 0x00]))).toThrow(CborError);
  });

  test("truncated input (head declares more than is present)", () => {
    expect(() => decode(new Uint8Array([0x42]))).toThrow(CborError); // bytes(2), no data
    expect(() => decode(new Uint8Array([0x18]))).toThrow(CborError); // uint8 head, no byte
    expect(() => decode(new Uint8Array([0x1a, 0x00, 0x01]))).toThrow(CborError); // uint32 head, short
  });

  test("indefinite lengths are rejected", () => {
    expect(() => decode(new Uint8Array([0x9f]))).toThrow(CborError); // indefinite array
    expect(() => decode(new Uint8Array([0x5f]))).toThrow(CborError); // indefinite byte string
  });

  test("unsupported major types are rejected", () => {
    expect(() => decode(new Uint8Array([0x20]))).toThrow(CborError); // major 1 (negative int)
    expect(() => decode(new Uint8Array([0xc0]))).toThrow(CborError); // major 6 (tag)
    expect(() => decode(new Uint8Array([0xe0]))).toThrow(CborError); // major 7 (simple/float)
  });

  test("a map with a non-uint key is rejected", () => {
    // map(1){ "a": 1 } = a1 61 61 01 — the key is text (major 3), not a uint.
    expect(() => decode(new Uint8Array([0xa1, 0x61, 0x61, 0x01]))).toThrow(CborError);
  });

  test("a 64-bit integer over MAX_SAFE_INTEGER is rejected", () => {
    // 1b + 0xffffffffffffffff = 2^64-1, far beyond 2^53-1.
    expect(() => decode(new Uint8Array([0x1b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]))).toThrow(CborError);
  });

  test("invalid UTF-8 in a text string throws (fatal decode)", () => {
    // 0x61 = text(1), 0xff is not valid UTF-8. TextDecoder(fatal) rejects it.
    expect(() => decode(new Uint8Array([0x61, 0xff]))).toThrow();
  });
});
