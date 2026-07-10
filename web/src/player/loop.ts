// Animates a QR-part STREAM on a canvas at a given frame rate and scale
// (blueprint §6.1 Playing state). The source is a producer called once per
// displayed frame — an ENDLESS fountain stream (encoder.nextPart), NOT a fixed
// looped set: every frame is a fresh mixture, so the receiver never waits a loop
// boundary to re-catch a missed fragment (docs/23, "last-1% tail"). Rate and
// scale are the two mutable presentation knobs (R-ADJUST).
import { renderUrToCanvas } from "../qr/render.js";

export interface FrameInfo {
  index: number;
  total: number;
  cycles: number;
}

export class FramePlayer {
  fps: number;
  scale: number;
  onFrame?: (info: FrameInfo) => void;

  private next: (() => string) | null = null;
  private total = 0;
  private count = 0;
  private raf = 0;
  private lastDraw = 0;
  private running = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    opts: { fps: number; scale: number },
  ) {
    this.fps = opts.fps;
    this.scale = opts.scale;
  }

  // `next` produces the next QR string each displayed frame (endless stream).
  // `total` = the systematic part count — the denominator for the loop/ETA
  // display in onFrame (index cycles 0..total-1, cycles = systematic passes shown).
  load(next: () => string, total: number): void {
    this.next = next;
    this.total = total;
    this.count = 0;
    this.lastDraw = 0;
  }

  start(): void {
    if (this.running || !this.next || this.total === 0) return;
    this.running = true;
    this.lastDraw = 0;
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  get isRunning(): boolean {
    return this.running;
  }

  private tick = (t: number): void => {
    if (!this.running || !this.next) return;
    const interval = 1000 / this.fps;
    if (this.lastDraw === 0 || t - this.lastDraw >= interval) {
      this.lastDraw = t;
      renderUrToCanvas(this.next(), this.canvas, { scale: this.scale });
      const total = this.total || 1;
      this.onFrame?.({ index: this.count % total, total, cycles: Math.floor(this.count / total) });
      this.count++;
    }
    this.raf = requestAnimationFrame(this.tick);
  };
}
