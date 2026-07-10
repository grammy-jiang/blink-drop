import { beforeAll, describe, expect, it } from "vitest";
import { Assembler, buildFilesMessage, type FileInput, qrPartStream, systematicQrParts } from "../src/core/index.js";
import { lcg, shuffledCycler } from "../src/player/cycler.js";

// Simulate camera frame loss through the REAL bc-ur decoder (the user's idea).
// The "stuck at 99%" tail is ALIASED loss — the same display POSITIONS chronically
// fail to decode (scan-phase / focus), not random blur (which, as this file shows,
// causes NO tail). A fixed-ORDER loop shows the same content at each position, so
// aliased loss chronically drops the same fragments and STALLS; the shuffled cycler
// varies content-per-position each pass and escapes it. Regression guard for #86
// (docs/23 test 4/5). Deterministic throughout — no Math.random, no timers.

function textFile(n: number, seed: number): FileInput {
  const r = lcg(seed);
  const w = ["the", "quick", "brown", "fox", "lorem", "ipsum", "data", "frame", "qr", "blink"];
  let s = "";
  while (s.length < n) s += `${w[(r() * w.length) | 0]} `;
  return { bytes: Uint8Array.from(s.slice(0, n), (c) => c.charCodeAt(0)), name: "big.txt", mediaType: "text/plain" };
}

// Play `produce`d frames, drop those where `lost(k)`, feed survivors to the real
// decoder; return frames-to-complete, or null if it never completes within `cap`.
function playUntilDone(produce: () => string, lost: (k: number) => boolean, cap: number): number | null {
  const asm = new Assembler();
  for (let k = 0; k < cap; k++) {
    const part = produce();
    if (!lost(k)) asm.receiveQr(part);
    if (asm.isSuccess) return k + 1;
  }
  return null;
}

const FRAG = 800;
const fixedOrder = (pool: string[]): (() => string) => {
  let i = 0;
  return () => pool[i++ % pool.length]!;
};
const independent = (p: number, seed: number): ((k: number) => boolean) => {
  const r = lcg(seed);
  return () => r() < p;
};
// Aliased loss: a fixed ~pct% subset of display phases (period = pool length)
// always fails — the chronic-miss pattern behind the real-device tail.
const aliased =
  (period: number, pct: number): ((k: number) => boolean) =>
  (k) =>
    (((k % period) * 2654435761) >>> 0) % 100 < pct;

describe("frame loss (simulated camera misses, real decoder)", () => {
  let pool: string[];
  let seqLen: number;
  let cap: number;

  beforeAll(async () => {
    // Big enough that the surviving mixtures can't cover a chronically-missed 40%
    // of fragments — the regime where the fixed-order loop actually stalls (a tiny
    // transfer recovers from mixtures regardless, so it wouldn't show the bug).
    const msg = await buildFilesMessage([textFile(400 * 1024, 1)], {});
    seqLen = systematicQrParts(msg, FRAG).length;
    pool = qrPartStream(msg, seqLen * 2, FRAG); // systematic + equal mixtures
    // Under DETERMINISTIC aliased loss a fixed loop repeats identically after one
    // pass (period = pool length) — so it completes in pass 1 or never; a shuffled
    // loop re-randomises each pass. This budget gives shuffle many passes.
    cap = pool.length * 12;
  });

  it("random (independent) loss causes NO tail — every strategy completes", () => {
    // The negative control: if the tail were random blur, this would stall. It
    // doesn't — so random loss is NOT the cause.
    expect(playUntilDone(shuffledCycler(pool, lcg(pool.length)), independent(0.6, 11), cap)).not.toBeNull();
    expect(playUntilDone(fixedOrder(pool), independent(0.6, 11), cap)).not.toBeNull();
  });

  it("a fixed-order loop STALLS under aliased loss (reproduces the 99% tail)", () => {
    // Same content at each position + the same positions failing ⇒ ~40% of
    // fragments are chronically missed and never recovered.
    expect(playUntilDone(fixedOrder(pool), aliased(pool.length, 40), cap)).toBeNull();
  });

  it("the shuffled cycler ESCAPES aliased loss and completes (the #86 fix)", () => {
    // Reshuffling each pass moves every fragment off the failing phase eventually.
    expect(playUntilDone(shuffledCycler(pool, lcg(pool.length)), aliased(pool.length, 40), cap)).not.toBeNull();
  });
});
