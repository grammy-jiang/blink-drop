// Camera capture for the PWA receiver: getUserMedia -> video -> canvas -> jsQR.
// Requires a secure context (HTTPS or localhost) — iOS Safari blocks the camera
// otherwise. This is the real product capture path (the M0 debug harness used
// the same jsQR scan on a synthetic stream).
import { scanCanvas } from "../qr/scan.js";
import { ScanStatsTracker } from "./scan-stats.js";

// The receiver's real capability, measured on-device and surfaced to the UI so the
// human can match the sender's speed to it (docs/23 — the devices have no
// back-channel; the human is the channel).
export interface CameraStats {
  width: number;
  height: number;
  scanFps: number;
  decodeMs: number;
}

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
// with each decoded QR string (or null) every scan tick. `onStats` (optional) is
// called ~once a second with the measured capture resolution + scan rate.
export async function startCamera(
  mount: HTMLElement,
  onFrame: (qr: string | null) => void,
  onStats?: (stats: CameraStats) => void,
): Promise<CameraHandle> {
  if (!isSecureContextOk()) {
    throw new CameraError("InsecureContext", "camera needs a secure (https) context");
  }
  let stream: MediaStream;
  try {
    // Request 1080p — the iPhone 15 Pro Max delivers it (confirmed on-device), and
    // more pixels/module is what lets the denser default fragment decode reliably.
    // Without asking, iOS hands back a ~480p default that starves the QR of pixels.
    // `ideal` is a soft constraint: it degrades, never throws, on lesser devices —
    // and the receiver shows the resolution it actually got, so nobody is misled.
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
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
  const tracker = new ScanStatsTracker();
  let lastReport = 0;
  const timer = window.setInterval(() => {
    if (video.videoWidth === 0) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const t0 = performance.now();
    const qr = scanCanvas(canvas);
    onFrame(qr);
    if (onStats) {
      // Measure the REAL scan rate (CPU-bound: decode can exceed the 50 ms tick)
      // and surface it so the human can keep the sender ≤ ~½ of it.
      tracker.sample(t0, performance.now() - t0);
      if (t0 - lastReport >= 1000) {
        lastReport = t0;
        const s = tracker.stats;
        onStats({ width: video.videoWidth, height: video.videoHeight, scanFps: s.scanFps, decodeMs: s.decodeMs });
      }
    }
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
