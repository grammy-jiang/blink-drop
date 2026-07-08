import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { renderTextToCanvas, renderUrToCanvas } from "../src/qr/render.js";
import { scanCanvas, scanImageData } from "../src/qr/scan.js";

// Full QR round-trip on a real 2D canvas (@napi-rs/canvas — prebuilt, no cairo).
// This is the render → scan contract the sender's animation and the receiver's
// scanner both rely on, exercised without a browser.
function fresh(): HTMLCanvasElement {
  return createCanvas(1, 1) as unknown as HTMLCanvasElement;
}

describe("QR render → scan round-trip", () => {
  it("renders a UR part (alphanumeric, ECC-L) and scans back the exact string", () => {
    const ur = "UR:BLINK-DROP/1OF1/TESTDATA0123456789";
    const canvas = fresh();
    renderUrToCanvas(ur, canvas, { scale: 6, margin: 4 });
    expect(canvas.width).toBeGreaterThan(0);
    expect(scanCanvas(canvas)).toBe(ur);
  });

  it("renders arbitrary text (byte, ECC-M) — the sender's 'open receiver' QR", () => {
    const url = "https://grammy.jiang.is/blink-drop/receiver.html";
    const canvas = fresh();
    renderTextToCanvas(url, canvas, { scale: 4, margin: 4 });
    expect(scanCanvas(canvas)).toBe(url);
  });

  it("honors the scale option (bigger scale → bigger canvas)", () => {
    const ur = "UR:BLINK-DROP/1OF1/AAA";
    const small = fresh();
    const big = fresh();
    renderUrToCanvas(ur, small, { scale: 3, margin: 2 });
    renderUrToCanvas(ur, big, { scale: 9, margin: 2 });
    expect(big.width).toBeGreaterThan(small.width);
    expect(scanCanvas(big)).toBe(ur);
  });
});

describe("scan edge cases", () => {
  it("returns null when the image has no QR code", () => {
    const canvas = createCanvas(80, 80);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 80, 80); // blank white — no code
    const img = ctx.getImageData(0, 0, 80, 80) as unknown as ImageData;
    expect(scanImageData(img)).toBeNull();
  });

  it("throws a clear error when the canvas has no 2d context", () => {
    const noCtx = { width: 10, height: 10, getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => scanCanvas(noCtx)).toThrow("2d canvas context unavailable");
  });
});
