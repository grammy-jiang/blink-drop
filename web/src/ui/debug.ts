// Developer regression harness (loaded only on ?debug / ?selftest / ?streamtest).
// Camera-free proofs of the render/decode pipeline, kept from M0:
//  - self-test: core -> QR render -> jsQR -> core -> verify (no camera)
//  - stream-test: sender canvas -> captureStream (synthetic camera) -> scan loop -> verify
import {
  Assembler,
  buildMessage,
  bytesEqual,
  DEFAULT_MAX_FRAGMENT_LENGTH,
  type DecodedFile,
  type FileInput,
  KDF_ARGON2ID,
  openMessage,
  qrPartStream,
  systematicQrParts,
} from "../core/index.js";
import { FramePlayer } from "../player/loop.js";
import { renderUrToCanvas } from "../qr/render.js";
import { scanCanvas } from "../qr/scan.js";

function pseudoBytes(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = (s >>> 24) & 0xff;
  }
  return out;
}

interface CaseResult {
  name: string;
  parts: number;
  renderScanMatched: number;
  reconstructed: boolean;
  verified: boolean;
  error?: string;
}

let logSink: (msg: string) => void = () => {};

async function runCase(name: string, input: FileInput, frag: number): Promise<CaseResult> {
  const message = await buildMessage(input);
  const parts = systematicQrParts(message, frag);
  let renderScanMatched = 0;
  let scanError: string | undefined;
  const recovered: string[] = [];
  const cv = document.createElement("canvas");
  let idx = 0;
  for (const part of parts) {
    try {
      renderUrToCanvas(part, cv, { scale: 5, margin: 4 });
      const got = scanCanvas(cv);
      if (got !== null) {
        recovered.push(got);
        if (got.toUpperCase() === part) renderScanMatched++;
      }
    } catch (e) {
      scanError = `render/scan part ${idx}: ${String(e)}`;
    }
    if (++idx % 4 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  const asm = new Assembler();
  for (const r of recovered) asm.receiveQr(r);
  let reconstructed = false;
  let verified = false;
  let error: string | undefined = scanError;
  if (asm.isSuccess) {
    reconstructed = true;
    try {
      const decoded: DecodedFile = await openMessage(asm.message());
      verified = bytesEqual(decoded.bytes, input.bytes);
    } catch (e) {
      error = String(e);
    }
  }
  return { name, parts: parts.length, renderScanMatched, reconstructed, verified, error };
}

export async function runSelfTest(): Promise<{ ok: boolean; cases: CaseResult[] }> {
  logSink("running camera-free loopback self-test (core → render → jsQR → core → verify)…");
  const cases = [
    await runCase(
      "text (single fragment)",
      { bytes: new TextEncoder().encode("Blink-Drop ".repeat(3)), name: "a.txt", mediaType: "text/plain" },
      DEFAULT_MAX_FRAGMENT_LENGTH,
    ),
    await runCase(
      "multi-fragment binary",
      { bytes: pseudoBytes(3000, 11), name: "blob.bin", mediaType: "application/octet-stream" },
      200,
    ),
  ];
  const ok = cases.every((c) => c.reconstructed && c.verified && c.renderScanMatched === c.parts);
  for (const c of cases) {
    logSink(
      `• ${c.name}: parts=${c.parts} render→scan matched=${c.renderScanMatched}/${c.parts} reconstructed=${c.reconstructed} verified=${c.verified}${c.error ? ` error=${c.error}` : ""}`,
    );
  }
  logSink(ok ? "SELFTEST PASS ✓" : "SELFTEST FAIL ✗");
  const summary = { ok, cases };
  (window as unknown as { __selftest: typeof summary }).__selftest = summary;
  return summary;
}

export interface StreamTestSummary {
  ok: boolean;
  seqLen: number;
  frames: number;
  reconstructed: boolean;
  verified: boolean;
  rejected: boolean;
  encrypted: boolean;
  tampered: boolean;
}

// Optical round-trip proof, parametrised so the E2E suite can exercise the real
// pipeline in every browser (incl. WebKit = Safari's engine):
//   - plain:     sender canvas → captureStream → scan → reconstruct → verify
//   - encrypted: same, but AES-GCM + Argon2id (proves the WASM KDF cross-browser)
//   - tamper:    flip bytes in the reconstructed message → the SHA-256 gate (or
//                AEAD tag) MUST reject it. Corrupt data is never "verified" —
//                the receiver's core security invariant.
export async function runStreamTest(opts: { passphrase?: string; tamper?: boolean } = {}): Promise<StreamTestSummary> {
  const { passphrase, tamper = false } = opts;
  const encrypted = !!passphrase;
  const mode = tamper ? "tamper" : encrypted ? "encrypted" : "plain";
  logSink(`stream test (${mode}): sender canvas → captureStream → video → scan loop → verify…`);
  const input: FileInput = { bytes: pseudoBytes(2500, 7), name: "stream.bin", mediaType: "application/octet-stream" };
  const message = await buildMessage(input, encrypted ? { passphrase, kdf: KDF_ARGON2ID } : {});
  const frag = 200;
  const seqLen = systematicQrParts(message, frag).length;
  const parts = qrPartStream(message, seqLen * 3, frag);
  const senderCanvas = document.createElement("canvas");
  renderUrToCanvas(parts[0]!, senderCanvas, { scale: 6, margin: 4 });
  const player = new FramePlayer(senderCanvas, { fps: 10, scale: 6 });
  player.load(parts);
  player.start();
  const stream = senderCanvas.captureStream(15);
  const video = document.createElement("video");
  video.muted = true;
  video.setAttribute("playsinline", "true");
  video.srcObject = stream;
  await video.play();
  const cv = document.createElement("canvas");
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  const asm = new Assembler();
  let frames = 0;
  while (!asm.isSuccess && frames < 3000) {
    frames++;
    if (video.videoWidth > 0) {
      cv.width = video.videoWidth;
      cv.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const got = scanCanvas(cv);
      if (got !== null) asm.receiveQr(got);
    }
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
  player.stop();
  for (const t of stream.getTracks()) t.stop();

  const reconstructed = asm.isSuccess;
  let verified = false;
  let rejected = false;
  if (reconstructed) {
    let bytes = asm.message();
    if (tamper) {
      bytes = bytes.slice();
      const mid = Math.floor(bytes.length / 2);
      for (const i of [mid, mid + 1, mid + 2]) bytes[i] = ((bytes[i] ?? 0) ^ 0xff) & 0xff;
    }
    try {
      const decoded: DecodedFile = await openMessage(bytes, encrypted ? { passphrase } : {});
      verified = bytesEqual(decoded.bytes, input.bytes);
    } catch {
      // Expected for tamper (SHA/AEAD reject); a failure for the honest modes.
      rejected = true;
    }
  }

  // Success = the mode behaved correctly: tamper must NOT verify (rejected or a
  // content mismatch); plain/encrypted must verify.
  const ok = reconstructed && (tamper ? !verified : verified);
  logSink(
    `• mode=${mode} seqLen=${seqLen} frames=${frames} reconstructed=${reconstructed} verified=${verified} rejected=${rejected}`,
  );
  logSink(ok ? "STREAM TEST PASS ✓" : "STREAM TEST FAIL ✗");
  const summary: StreamTestSummary = {
    ok,
    seqLen,
    frames,
    reconstructed,
    verified,
    rejected,
    encrypted,
    tampered: tamper,
  };
  (window as unknown as { __streamtest: StreamTestSummary }).__streamtest = summary;
  return summary;
}

export interface LoopbackSummary {
  ok: boolean;
  parts: number;
  scanned: number;
  reconstructed: boolean;
  verified: boolean;
  rejected: boolean;
  encrypted: boolean;
  tampered: boolean;
}

// Camera-free optical loopback: core → QR render → jsQR scan → reconstruct →
// [optional tamper] → open → verify. Unlike runStreamTest it uses NO
// captureStream / <video> / getUserMedia, so it runs in every engine — including
// Playwright's WebKit, whose captureStream yields no frames. This proves the
// jsQR decode + core reconstruct + AES-GCM/Argon2id/SHA-256 stack in Safari's
// engine (the receiver's iOS target); the live camera transport itself can only
// be validated on a real device.
export async function runLoopback(opts: { passphrase?: string; tamper?: boolean } = {}): Promise<LoopbackSummary> {
  const { passphrase, tamper = false } = opts;
  const encrypted = !!passphrase;
  const mode = tamper ? "tamper" : encrypted ? "encrypted" : "plain";
  logSink(`loopback (${mode}): core → render → jsQR → reconstruct → verify (camera-free)…`);
  const input: FileInput = { bytes: pseudoBytes(2500, 7), name: "loop.bin", mediaType: "application/octet-stream" };
  const message = await buildMessage(input, encrypted ? { passphrase, kdf: KDF_ARGON2ID } : {});
  const parts = systematicQrParts(message, 200);
  const cv = document.createElement("canvas");
  const asm = new Assembler();
  let scanned = 0;
  let idx = 0;
  for (const part of parts) {
    renderUrToCanvas(part, cv, { scale: 5, margin: 4 });
    const got = scanCanvas(cv);
    if (got !== null) {
      scanned++;
      asm.receiveQr(got);
    }
    if (++idx % 8 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  const reconstructed = asm.isSuccess;
  let verified = false;
  let rejected = false;
  if (reconstructed) {
    let bytes = asm.message();
    if (tamper) {
      bytes = bytes.slice();
      const mid = Math.floor(bytes.length / 2);
      for (const i of [mid, mid + 1, mid + 2]) bytes[i] = ((bytes[i] ?? 0) ^ 0xff) & 0xff;
    }
    try {
      const decoded: DecodedFile = await openMessage(bytes, encrypted ? { passphrase } : {});
      verified = bytesEqual(decoded.bytes, input.bytes);
    } catch {
      rejected = true;
    }
  }

  const ok = reconstructed && (tamper ? !verified : verified);
  logSink(
    `• mode=${mode} parts=${parts.length} scanned=${scanned} reconstructed=${reconstructed} verified=${verified} rejected=${rejected}`,
  );
  logSink(ok ? "LOOPBACK PASS ✓" : "LOOPBACK FAIL ✗");
  const summary: LoopbackSummary = {
    ok,
    parts: parts.length,
    scanned,
    reconstructed,
    verified,
    rejected,
    encrypted,
    tampered: tamper,
  };
  (window as unknown as { __loopback: LoopbackSummary }).__loopback = summary;
  return summary;
}

export function mountDebug(root: HTMLElement): void {
  root.innerHTML = "";
  const h = document.createElement("h1");
  h.textContent = "Blink-Drop — Receiver (debug harness)";
  const bar = document.createElement("div");
  const result = document.createElement("div");
  result.style.cssText = "margin-top:1rem;font-family:ui-monospace,monospace;font-size:.9rem;white-space:pre-wrap";
  logSink = (msg: string): void => {
    console.log(`[blinkdrop] ${msg}`);
    const line = document.createElement("div");
    line.textContent = msg;
    result.appendChild(line);
  };
  const btn = (label: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.marginRight = ".5rem";
    b.addEventListener("click", fn);
    return b;
  };
  bar.append(
    btn("Run self-test", () => {
      result.textContent = "";
      void runSelfTest();
    }),
    btn("Run stream test", () => {
      result.textContent = "";
      void runStreamTest();
    }),
  );
  root.append(h, bar, result);

  const params = new URLSearchParams(location.search);
  if (params.has("selftest")) void runSelfTest();
  if (params.has("streamtest"))
    void runStreamTest({ passphrase: params.get("pass") ?? undefined, tamper: params.has("tamper") });
  if (params.has("loopback"))
    void runLoopback({ passphrase: params.get("pass") ?? undefined, tamper: params.has("tamper") });
}
