import { describe, expect, it } from "vitest";
import { lcg, shuffledCycler } from "../src/player/cycler.js";

describe("lcg", () => {
  it("is deterministic for a seed and returns [0,1)", () => {
    const a = lcg(42);
    const b = lcg(42);
    for (let i = 0; i < 5; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("shuffledCycler", () => {
  const pool = ["a", "b", "c", "d", "e"];

  it("yields every pool item exactly once per pass (a permutation)", () => {
    const next = shuffledCycler(pool, lcg(1));
    const pass = Array.from({ length: pool.length }, () => next());
    expect([...pass].sort()).toEqual([...pool].sort());
  });

  it("re-shuffles between passes (order changes, still a permutation)", () => {
    const next = shuffledCycler(pool, lcg(7));
    const p1 = Array.from({ length: pool.length }, () => next());
    const p2 = Array.from({ length: pool.length }, () => next());
    expect([...p2].sort()).toEqual([...pool].sort()); // still complete
    expect(p2).not.toEqual(p1); // and reordered (seed 7 gives distinct passes)
  });

  it("keeps producing forever (endless)", () => {
    const next = shuffledCycler(pool, lcg(3));
    const seen = new Set<string>();
    for (let i = 0; i < pool.length * 4; i++) seen.add(next());
    expect(seen).toEqual(new Set(pool));
  });

  it("is safe on an empty pool", () => {
    const next = shuffledCycler([], lcg(1));
    expect(next()).toBe("");
  });
});
