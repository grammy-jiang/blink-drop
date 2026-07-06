// Render a UR part string to a QR code on a canvas (docs/01-protocol.md §6).
// The part is already UPPERCASED by the core; qrcode-generator's Alphanumeric
// mode encodes it (every char — letters, digits, ` : / - . ` — is in the QR
// alphanumeric charset), lowest error-correction level (stream-level fountain
// redundancy replaces symbol-level ECC, blueprint L6).
import qrcode from "qrcode-generator";

export interface RenderOptions {
  scale?: number; // pixels per module
  margin?: number; // quiet-zone modules
}

export function renderUrToCanvas(urUpper: string, canvas: HTMLCanvasElement, opts: RenderOptions = {}): void {
  const scale = opts.scale ?? 6;
  const margin = opts.margin ?? 4;

  const qr = qrcode(0, "L"); // typeNumber 0 = auto-size to the data
  qr.addData(urUpper, "Alphanumeric");
  qr.make();

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
