import { describe, expect, test } from "vitest";
import { bytesEqual, sha256 } from "../src/core/index.js";

const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

describe("digest", () => {
  test("sha256 matches the known empty-input vector", async () => {
    // SHA-256("") is a fixed, well-known value.
    // gitleaks:allow — this is the public SHA-256("") test vector, not a secret.
    expect(hex(await sha256(new Uint8Array(0)))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", // gitleaks:allow
    );
  });

  test("bytesEqual: equal, same-length-but-different, and mismatched lengths", () => {
    const a = new Uint8Array([1, 2, 3]);
    expect(bytesEqual(a, new Uint8Array([1, 2, 3]))).toBe(true);
    expect(bytesEqual(a, new Uint8Array([1, 2, 4]))).toBe(false); // same length, one byte differs
    // The length-mismatch branch (the early `return false`) is otherwise only
    // reached defensively — SHA-256 digests are always 32 bytes in real use.
    expect(bytesEqual(a, new Uint8Array([1, 2]))).toBe(false); // shorter
    expect(bytesEqual(a, new Uint8Array([1, 2, 3, 4]))).toBe(false); // longer
    expect(bytesEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true); // both empty
  });
});
