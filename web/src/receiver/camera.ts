// Camera capture for the PWA receiver: getUserMedia -> video -> canvas -> jsQR.
// Requires a secure context (HTTPS or localhost) — iOS Safari blocks the camera
// otherwise. This is the real product capture path (the M0 debug harness used
// the same jsQR scan on a synthetic stream).
import { scanCanvas } from "../qr/scan.js";

export function isSecureContextOk(): boolean {
  return window.isSecureContext === true;
}

export class CameraError extends Error {
  constructor(
    override readonly name: "InsecureContext" | "PermissionDenied" | "NoCamera" | "CameraFailed",
    message: string,
  ) {
    super(message);
  }
}

export interface CameraHandle {
  readonly video: HTMLVideoElement;
  stop(): void;
}

// Starts the camera, mounts a live preview into `mount`, and calls `onFrame`
// with each decoded QR string (or null) every animation frame.
export async function startCamera(mount: HTMLElement, onFrame: (qr: string | null) => void): Promise<CameraHandle> {
  if (!isSecureContextOk()) {
    throw new CameraError("InsecureContext", "camera needs a secure (https) context");
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  } catch (e) {
    const name = (e as Error).name;
    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new CameraError("PermissionDenied", "camera permission denied");
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      throw new CameraError("NoCamera", "no usable camera");
    }
    throw new CameraError("CameraFailed", String(e));
  }

  const video = document.createElement("video");
  video.setAttribute("playsinline", "true");
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  mount.appendChild(video);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new CameraError("CameraFailed", "no 2d canvas context");

  // A ~20 fps interval (not requestAnimationFrame): a scanner doesn't need
  // display-refresh sync, this caps CPU, and — unlike rAF — it still fires when
  // the page is briefly backgrounded.
  const SCAN_INTERVAL_MS = 50;
  const timer = window.setInterval(() => {
    if (video.videoWidth === 0) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    onFrame(scanCanvas(canvas));
  }, SCAN_INTERVAL_MS);

  return {
    video,
    stop(): void {
      clearInterval(timer);
      for (const track of stream.getTracks()) track.stop();
      video.remove();
    },
  };
}
