// Rolling scan-rate + decode-time tracker for the camera loop (docs/23 capability
// display). Pure — no DOM, camera, or timers — so it is unit-testable by feeding
// it timestamps. The loop samples it each tick; the receiver UI reads `.stats`.
export interface ScanStats {
  scanFps: number; // effective frames scanned per second (CPU-bound, EMA)
  decodeMs: number; // mean jsQR decode cost per frame (EMA)
}

export class ScanStatsTracker {
  private seen = false;
  private seenDecode = false;
  private lastTick = 0;
  private emaInterval = 0;
  private emaDecode = 0;
  private readonly alpha: number;

  constructor(alpha = 0.2) {
    this.alpha = alpha; // EMA smoothing; higher = more reactive
  }

  // Call once per scan tick: `now` = tick start time, `decodeMs` = that tick's
  // decode cost. Both in the same monotonic clock (e.g. performance.now()).
  sample(now: number, decodeMs: number): void {
    if (this.seen) {
      const dt = now - this.lastTick;
      this.emaInterval = this.emaInterval === 0 ? dt : this.emaInterval + this.alpha * (dt - this.emaInterval);
    }
    this.seen = true;
    this.lastTick = now;
    this.emaDecode = !this.seenDecode ? decodeMs : this.emaDecode + this.alpha * (decodeMs - this.emaDecode);
    this.seenDecode = true;
  }

  get stats(): ScanStats {
    return {
      scanFps: this.emaInterval > 0 ? 1000 / this.emaInterval : 0,
      decodeMs: this.emaDecode,
    };
  }
}
