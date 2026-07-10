import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_FRAGMENT_LENGTH,
  DEFAULT_REDUNDANCY,
  MAX_FRAGMENT_LENGTH,
  MAX_REDUNDANCY,
  MIN_FRAGMENT_LENGTH,
  MIN_REDUNDANCY,
} from "../src/core/index.js";
import { parseTransferParams } from "../src/ui/transfer-params.js";

describe("parseTransferParams", () => {
  it("returns the device-budget defaults when no params are present", () => {
    const t = parseTransferParams("");
    expect(t.frag).toBe(DEFAULT_MAX_FRAGMENT_LENGTH);
    expect(t.redundancy).toBe(DEFAULT_REDUNDANCY);
  });

  it("reads valid in-range params", () => {
    const t = parseTransferParams("?frag=900&redundancy=3");
    expect(t.frag).toBe(900);
    expect(t.redundancy).toBe(3);
  });

  it("clamps values above the range (no impossible-QR / runaway params)", () => {
    const t = parseTransferParams("?frag=99999&redundancy=99");
    expect(t.frag).toBe(MAX_FRAGMENT_LENGTH);
    expect(t.redundancy).toBe(MAX_REDUNDANCY);
  });

  it("clamps values below the range", () => {
    const t = parseTransferParams("?frag=1&redundancy=0");
    expect(t.frag).toBe(MIN_FRAGMENT_LENGTH);
    expect(t.redundancy).toBe(MIN_REDUNDANCY);
  });

  it("falls back to defaults on non-numeric garbage (a typo must not brick a send)", () => {
    const t = parseTransferParams("?frag=abc&redundancy=xyz");
    expect(t.frag).toBe(DEFAULT_MAX_FRAGMENT_LENGTH);
    expect(t.redundancy).toBe(DEFAULT_REDUNDANCY);
  });

  it("rounds a fractional fragment to an integer byte length", () => {
    const t = parseTransferParams("?frag=800.7");
    expect(t.frag).toBe(801);
    expect(Number.isInteger(t.frag)).toBe(true);
  });
});
