import { describe, expect, it } from "vitest";
import { ScanStatsTracker } from "../src/receiver/scan-stats.js";

describe("ScanStatsTracker", () => {
  it("reports 0 fps until it has two ticks to measure an interval", () => {
    const t = new ScanStatsTracker();
    expect(t.stats.scanFps).toBe(0);
    t.sample(0, 5); // now === 0 must still count as the first tick
    expect(t.stats.scanFps).toBe(0);
  });

  it("computes scan fps from tick intervals (alpha=1 = exact last interval)", () => {
    const t = new ScanStatsTracker(1);
    t.sample(0, 10);
    t.sample(50, 10); // 50 ms interval -> 20 fps
    expect(t.stats.scanFps).toBeCloseTo(20, 5);
    t.sample(150, 10); // 100 ms interval -> 10 fps
    expect(t.stats.scanFps).toBeCloseTo(10, 5);
  });

  it("tracks mean decode cost", () => {
    const t = new ScanStatsTracker(1);
    t.sample(0, 12);
    expect(t.stats.decodeMs).toBeCloseTo(12, 5);
    t.sample(50, 20);
    expect(t.stats.decodeMs).toBeCloseTo(20, 5);
  });

  it("smooths a steady rate with EMA (alpha<1)", () => {
    const t = new ScanStatsTracker(0.5);
    t.sample(0, 10);
    t.sample(100, 10); // seed interval = 100
    t.sample(200, 10); // steady -> stays 100 ms -> 10 fps
    expect(t.stats.scanFps).toBeCloseTo(10, 5);
  });
});
