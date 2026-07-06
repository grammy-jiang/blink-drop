// Decode a QR code from image pixels back to its string, using jsQR (pure JS).
// jsQR is used instead of the native BarcodeDetector because BarcodeDetector is
// unavailable on desktop Linux Chrome and on iOS Safari — jsQR runs everywhere,
// which the throwaway browser receiver (and its phone-browser use) needs.
import jsQR from "jsqr";

export function scanImageData(image: ImageData): string | null {
  const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
  return code ? code.data : null;
}

export function scanCanvas(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d canvas context unavailable");
  return scanImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
}
