import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_FRAGMENT_LENGTH, MAX_FRAGMENT_LENGTH, MIN_FRAGMENT_LENGTH } from "../src/core/index.js";
import { parseTransferParams } from "../src/ui/transfer-params.js";

describe("parseTransferParams", () => {
  it("returns the device-budget default when no param is present", () => {
    expect(parseTransferParams("").frag).toBe(DEFAULT_MAX_FRAGMENT_LENGTH);
  });

  it("reads a valid in-range fragment", () => {
    expect(parseTransferParams("?frag=900").frag).toBe(900);
  });

  it("clamps above the range (no impossible-QR param)", () => {
    expect(parseTransferParams("?frag=99999").frag).toBe(MAX_FRAGMENT_LENGTH);
  });

  it("clamps below the range", () => {
    expect(parseTransferParams("?frag=1").frag).toBe(MIN_FRAGMENT_LENGTH);
  });

  it("falls back to the default on non-numeric garbage (a typo must not brick a send)", () => {
    expect(parseTransferParams("?frag=abc").frag).toBe(DEFAULT_MAX_FRAGMENT_LENGTH);
  });

  it("rounds a fractional fragment to an integer byte length", () => {
    const t = parseTransferParams("?frag=800.7");
    expect(t.frag).toBe(801);
    expect(Number.isInteger(t.frag)).toBe(true);
  });
});
