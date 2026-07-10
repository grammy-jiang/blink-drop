// Pure display formatters for the receiver, extracted so their branches are
// unit-testable in isolation — the values they format (a live scan timer, a real
// camera's capability) only occur with a real device, so covering the minute /
// resolution branches through the UI is impractical. See docs/23.
import type { CameraStats } from "../receiver/camera.js";

// "12s" under a minute, "1m 05s" beyond — for the live + final scan timer.
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

// The receiver's measured capability, shown so the human can keep the sender's
// speed ≤ ~½ the scan rate (docs/23) — e.g. "1080p · scan ~18 fps · keep sender ≤ 9".
export function formatCaps(s: CameraStats): string {
  const res =
    s.height >= 1080 ? "1080p" : s.height >= 720 ? "720p" : s.height >= 480 ? "480p" : `${s.width}×${s.height}`;
  const senderMax = Math.max(1, Math.floor(s.scanFps / 2));
  return `${res} · scan ~${Math.round(s.scanFps)} fps · keep sender ≤ ${senderMax}`;
}
