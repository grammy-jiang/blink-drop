// Animates a precomputed set of QR part strings on a canvas at a given frame
// rate and scale (blueprint §6.1 Playing state). Rate and scale are the two
// mutable presentation knobs (R-ADJUST); the parts themselves are fixed.
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

  private parts: string[] = [];
  private index = 0;
  private cycles = 0;
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

  load(parts: string[]): void {
    this.parts = parts;
    this.index = 0;
    this.cycles = 0;
    this.lastDraw = 0;
  }

  start(): void {
    if (this.running || this.parts.length === 0) return;
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
    if (!this.running) return;
    const interval = 1000 / this.fps;
    if (this.lastDraw === 0 || t - this.lastDraw >= interval) {
      this.lastDraw = t;
      const part = this.parts[this.index]!;
      renderUrToCanvas(part, this.canvas, { scale: this.scale });
      this.onFrame?.({ index: this.index, total: this.parts.length, cycles: this.cycles });
      this.index++;
      if (this.index >= this.parts.length) {
        this.index = 0;
        this.cycles++;
      }
    }
    this.raf = requestAnimationFrame(this.tick);
  };
}
