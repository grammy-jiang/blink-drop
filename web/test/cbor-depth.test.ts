import { describe, expect, it } from "vitest";
import { CborError, cborDecode } from "../src/core/index.js";

// Depth-bound regression (docs/19 C1). A hostile message can nest CBOR
// arrays/maps arbitrarily deep; each level costs ~1 byte, so the old unbounded
// recursive decode was a stack-overflow DoS on attacker-controlled input. The
// decoder now caps nesting at MAX_CBOR_DEPTH (32) and rejects deeper input with
// a typed CborError instead of overflowing the stack.

// n nested single-element arrays wrapping a 0 uint: [0x81 × n, 0x00].
// 0x81 = major type 4 (array), length 1.
function nestedArrays(n: number): Uint8Array {
  const out = new Uint8Array(n + 1);
  out.fill(0x81, 0, n);
  out[n] = 0x00; // uint 0 at the bottom
  return out;
}

// n nested single-entry maps keyed 0 wrapping a 0 uint: [0xA1, 0x00] × n, 0x00.
// 0xA1 = map(1); 0x00 = uint 0 (the key, then finally the bottom value).
function nestedMaps(n: number): Uint8Array {
  const out = new Uint8Array(2 * n + 1);
  for (let i = 0; i < n; i++) {
    out[2 * i] = 0xa1; // map(1)
    out[2 * i + 1] = 0x00; // key: uint 0
  }
  out[2 * n] = 0x00; // bottom value: uint 0
  return out;
}

describe("cbor decode depth bound", () => {
  it("accepts nesting up to the ceiling (32)", () => {
    expect(cborDecode(nestedArrays(4))).toBeDefined(); // a real, shallow shape
    expect(cborDecode(nestedArrays(32))).toBeDefined();
    expect(cborDecode(nestedMaps(32))).toBeDefined();
  });

  it("rejects arrays nested past the ceiling with a typed CborError, not a crash", () => {
    expect(() => cborDecode(nestedArrays(33))).toThrow(CborError);
    // Deep enough to have stack-overflowed the old recursive decoder; now it is
    // a fast, deterministic rejection (reads ~33 bytes, then throws).
    expect(() => cborDecode(nestedArrays(100_000))).toThrow(CborError);
  });

  it("rejects maps nested past the ceiling too", () => {
    expect(() => cborDecode(nestedMaps(33))).toThrow(CborError);
    expect(() => cborDecode(nestedMaps(100_000))).toThrow(CborError);
  });
});
