import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FrameInfo, FramePlayer } from "../src/player/loop.js";

// FramePlayer animates a QR-part STREAM on a canvas. We mock the renderer (its
// canvas output is irrelevant here) and stub requestAnimationFrame so ticks can
// be driven at controlled timestamps — isolating the frame-advance / cycle /
// fps-gating logic. rAF timestamps are always > 0 in a real browser (ms since
// load), so the tests use positive times.
vi.mock("../src/qr/render.js", () => ({ renderUrToCanvas: vi.fn() }));

import { renderUrToCanvas } from "../src/qr/render.js";

const render = vi.mocked(renderUrToCanvas);
const canvas = {} as HTMLCanvasElement;

// A deterministic producer that cycles a known set — stands in for the endless
// fountain stream so the cycle/index bookkeeping can be asserted against `total`.
function cycle(parts: string[]): () => string {
  let i = 0;
  return () => parts[i++ % parts.length]!;
}

let rafCb: FrameRequestCallback | null = null;

function frame(t: number): void {
  const cb = rafCb;
  rafCb = null;
  cb?.(t);
}

beforeEach(() => {
  rafCb = null;
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafCb = cb;
    return ++id;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  render.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FramePlayer", () => {
  it("does not start with an empty stream (total 0)", () => {
    const p = new FramePlayer(canvas, { fps: 10, scale: 6 });
    p.load(cycle([]), 0);
    p.start();
    expect(p.isRunning).toBe(false);
    expect(rafCb).toBeNull();
  });

  it("draws the first frame immediately on start", () => {
    const p = new FramePlayer(canvas, { fps: 10, scale: 6 });
    p.load(cycle(["ur:a", "ur:b"]), 2);
    p.start();
    expect(p.isRunning).toBe(true);
    frame(1); // first tick (t>0)
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenLastCalledWith("ur:a", canvas, { scale: 6 });
  });

  it("gates subsequent draws by fps (1000/fps ms)", () => {
    const p = new FramePlayer(canvas, { fps: 10, scale: 6 }); // interval 100ms
    p.load(cycle(["ur:a", "ur:b", "ur:c"]), 3);
    p.start();
    frame(1); // draw a
    frame(50); // 49ms since last draw < 100 → no draw (producer not advanced)
    expect(render).toHaveBeenCalledTimes(1);
    frame(101); // 100ms elapsed → draw b
    expect(render).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenLastCalledWith("ur:b", canvas, { scale: 6 });
  });

  it("reports index within `total` and counts cycles across the stream", () => {
    const seen: FrameInfo[] = [];
    const p = new FramePlayer(canvas, { fps: 1000, scale: 6 }); // interval 1ms
    p.onFrame = (i) => seen.push({ ...i });
    p.load(cycle(["ur:a", "ur:b"]), 2);
    p.start();
    frame(1); // index 0, cycles 0
    frame(3); // index 1, cycles 0
    frame(5); // index 0, cycles 1
    expect(seen).toEqual([
      { index: 0, total: 2, cycles: 0 },
      { index: 1, total: 2, cycles: 0 },
      { index: 0, total: 2, cycles: 1 },
    ]);
  });

  it("stop() halts drawing and cancels the frame", () => {
    const p = new FramePlayer(canvas, { fps: 1000, scale: 6 });
    p.load(cycle(["ur:a", "ur:b"]), 2);
    p.start();
    frame(1);
    expect(render).toHaveBeenCalledTimes(1);
    p.stop();
    expect(p.isRunning).toBe(false);
    expect(cancelAnimationFrame).toHaveBeenCalled();
    frame(2); // a stale tick after stop must not draw
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("honors a live scale change", () => {
    const p = new FramePlayer(canvas, { fps: 1000, scale: 6 });
    p.load(cycle(["ur:a", "ur:b"]), 2);
    p.start();
    frame(1);
    p.scale = 9;
    frame(3);
    expect(render).toHaveBeenLastCalledWith("ur:b", canvas, { scale: 9 });
  });

  it("start() is idempotent while already running", () => {
    const p = new FramePlayer(canvas, { fps: 10, scale: 6 });
    p.load(cycle(["ur:a"]), 1);
    p.start();
    const firstCb = rafCb;
    p.start(); // no second loop scheduled
    expect(rafCb).toBe(firstCb);
  });
});
