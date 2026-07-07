// Render a QR code onto a canvas.
//   renderUrToCanvas   — a UR part string (already UPPERCASED), alphanumeric
//                        mode, ECC-L (stream-level fountain redundancy replaces
//                        symbol-level ECC, blueprint L6).
//   renderTextToCanvas — arbitrary text (e.g. a URL), auto mode, ECC-M (a small,
//                        robust static code — the sender's "open the receiver" QR).
import qrcode from "qrcode-generator";

export interface RenderOptions {
  scale?: number; // pixels per module
  margin?: number; // quiet-zone modules
}

function draw(qr: ReturnType<typeof qrcode>, canvas: HTMLCanvasElement, scale: number, margin: number): void {
  const count = qr.getModuleCount();
  const size = (count + margin * 2) * scale;
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#000000";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) {
        ctx.fillRect((col + margin) * scale, (row + margin) * scale, scale, scale);
      }
    }
  }
}

export function renderUrToCanvas(urUpper: string, canvas: HTMLCanvasElement, opts: RenderOptions = {}): void {
  const qr = qrcode(0, "L"); // typeNumber 0 = auto-size to the data
  qr.addData(urUpper, "Alphanumeric");
  qr.make();
  draw(qr, canvas, opts.scale ?? 6, opts.margin ?? 4);
}

export function renderTextToCanvas(text: string, canvas: HTMLCanvasElement, opts: RenderOptions = {}): void {
  const qr = qrcode(0, "M"); // higher error correction for a small static code
  qr.addData(text); // auto mode (Byte for a URL)
  qr.make();
  draw(qr, canvas, opts.scale ?? 4, opts.margin ?? 4);
}
