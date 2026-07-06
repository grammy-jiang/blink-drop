import "../polyfill.js";
import {
  Assembler,
  buildMessage,
  bytesEqual,
  DEFAULT_MAX_FRAGMENT_LENGTH,
  type DecodedFile,
  type FileInput,
  openMessage,
  qrPartStream,
  systematicQrParts,
} from "../core/index.js";
import { FramePlayer } from "../player/loop.js";
import { renderUrToCanvas } from "../qr/render.js";
import { scanCanvas } from "../qr/scan.js";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

const resultEl = el<HTMLDivElement>("result");
const log = (msg: string): void => {
  console.log(`[blinkdrop] ${msg}`);
  const line = document.createElement("div");
  line.textContent = msg;
  resultEl.appendChild(line);
};

function pseudoBytes(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = (s >>> 24) & 0xff;
  }
  return out;
}

// Camera-free proof of the whole browser pipeline: core (in-browser, with the
// Buffer polyfill) -> QR render -> QR decode (jsQR) -> core decode -> verify.
// The only thing this does NOT cover vs the real receiver is the camera/optics.
interface SelfTestResult {
  ok: boolean;
  cases: Array<{
    name: string;
    parts: number;
    renderScanMatched: number;
    reconstructed: boolean;
    verified: boolean;
    error?: string;
  }>;
}

async function runCase(name: string, input: FileInput, frag: number): Promise<SelfTestResult["cases"][number]> {
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
    // Yield periodically so the render/scan loop doesn't block the main thread.
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

async function runSelfTest(): Promise<SelfTestResult> {
  resultEl.textContent = "";
  log("running camera-free loopback self-test (core → render → jsQR → core → verify)…");
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
    log(
      `• ${c.name}: parts=${c.parts} render→scan matched=${c.renderScanMatched}/${c.parts} reconstructed=${c.reconstructed} verified=${c.verified}${c.error ? ` error=${c.error}` : ""}`,
    );
  }
  log(ok ? "SELFTEST PASS ✓" : "SELFTEST FAIL ✗");
  const summary = { ok, cases };
  (window as unknown as { __selftest: SelfTestResult }).__selftest = summary;
  return summary;
}

// Real camera receiver (for the phone). Not driven by the automated test.
async function startCamera(): Promise<void> {
  resultEl.textContent = "";
  log("requesting camera…");
  const video = document.createElement("video");
  video.setAttribute("playsinline", "true");
  video.muted = true;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  } catch (e) {
    log(`camera unavailable: ${String(e)}`);
    return;
  }
  video.srcObject = stream;
  await video.play();
  el<HTMLDivElement>("cameraMount").appendChild(video);
  video.style.maxWidth = "100%";

  const cv = document.createElement("canvas");
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  const asm = new Assembler();

  const tick = async (): Promise<void> => {
    if (video.videoWidth > 0) {
      cv.width = video.videoWidth;
      cv.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const got = scanCanvas(cv);
      if (got !== null) {
        asm.receiveQr(got);
        el<HTMLDivElement>("progress").textContent =
          `collecting… ${asm.percentComplete}% (expected ~${asm.expectedPartCount} parts)`;
      }
      if (asm.isSuccess) {
        stream.getTracks().forEach((t) => {
          t.stop();
        });
        await finish(asm);
        return;
      }
    }
    requestAnimationFrame(() => void tick());
  };
  requestAnimationFrame(() => void tick());
}

async function finish(asm: Assembler): Promise<void> {
  try {
    const decoded = await openMessage(asm.message());
    log(`VERIFIED ✓ ${decoded.header.name} · ${decoded.bytes.length} B · ${decoded.header.mediaType}`);
    const blob = new Blob([decoded.bytes as unknown as BlobPart], { type: decoded.header.mediaType });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = decoded.header.name;
    a.textContent = `Save ${decoded.header.name}`;
    resultEl.appendChild(a);
  } catch (e) {
    log(`FAILED — file withheld: ${String(e)}`);
  }
}

// End-to-end test through the REAL camera code path, without a physical camera:
// animate a sender QR on a canvas, expose it as a MediaStream via
// canvas.captureStream() (a synthetic camera), and run the same video → frame →
// jsQR → assemble → verify loop the live camera uses. This exercises the video
// sampling the loopback self-test skipped; only real optics (lens/glare) remain.
interface StreamTestResult {
  ok: boolean;
  reconstructed: boolean;
  verified: boolean;
  seqLen: number;
  frames: number;
  distinctReceived: number;
  error?: string;
}

async function runStreamTest(): Promise<StreamTestResult> {
  resultEl.textContent = "";
  log("stream test: sender canvas → captureStream → video → scan loop → verify…");

  const input: FileInput = { bytes: pseudoBytes(2500, 7), name: "stream.bin", mediaType: "application/octet-stream" };
  const message = await buildMessage(input);
  const frag = 200;
  const seqLen = systematicQrParts(message, frag).length;
  const parts = qrPartStream(message, seqLen * 3, frag);

  // Sender animation on an offscreen canvas.
  const senderCanvas = document.createElement("canvas");
  renderUrToCanvas(parts[0]!, senderCanvas, { scale: 6, margin: 4 }); // size the canvas before capture
  const player = new FramePlayer(senderCanvas, { fps: 10, scale: 6 });
  player.load(parts);
  player.start();

  // Synthetic camera: the canvas as a live video stream.
  const stream = senderCanvas.captureStream(15);
  const video = document.createElement("video");
  video.muted = true;
  video.setAttribute("playsinline", "true");
  video.srcObject = stream;
  await video.play();

  // The receiver's real capture loop.
  const cv = document.createElement("canvas");
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  const asm = new Assembler();

  let frames = 0;
  const maxFrames = 3000;
  while (!asm.isSuccess && frames < maxFrames) {
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
  stream.getTracks().forEach((t) => {
    t.stop();
  });

  let verified = false;
  let error: string | undefined;
  if (asm.isSuccess) {
    try {
      const decoded = await openMessage(asm.message());
      verified = bytesEqual(decoded.bytes, input.bytes);
    } catch (e) {
      error = String(e);
    }
  }

  const result: StreamTestResult = {
    ok: asm.isSuccess && verified,
    reconstructed: asm.isSuccess,
    verified,
    seqLen,
    frames,
    distinctReceived: asm.expectedPartCount,
    ...(error ? { error } : {}),
  };
  log(
    `• seqLen=${seqLen} frames-sampled=${frames} reconstructed=${result.reconstructed} verified=${result.verified}${error ? ` error=${error}` : ""}`,
  );
  log(result.ok ? "STREAM TEST PASS ✓" : "STREAM TEST FAIL ✗");
  (window as unknown as { __streamtest: StreamTestResult }).__streamtest = result;
  return result;
}

// Diagnostics: surface any load-time or async error, and confirm the core (with
// the Buffer polyfill) actually loaded in the browser.
window.addEventListener("error", (e) => console.log(`[blinkdrop] window error: ${e.message}`));
window.addEventListener("unhandledrejection", (e) =>
  console.log(`[blinkdrop] unhandled rejection: ${String((e as PromiseRejectionEvent).reason)}`),
);
console.log(
  `[blinkdrop] receiver module loaded; Buffer=${typeof (globalThis as unknown as { Buffer?: unknown }).Buffer}`,
);

// Wire up.
el<HTMLButtonElement>("selftest").addEventListener("click", () => void runSelfTest());
el<HTMLButtonElement>("camera").addEventListener("click", () => void startCamera());
document.getElementById("streamtest")?.addEventListener("click", () => void runStreamTest());
(window as unknown as { runSelfTest: typeof runSelfTest; runStreamTest: typeof runStreamTest }).runSelfTest =
  runSelfTest;
(window as unknown as { runStreamTest: typeof runStreamTest }).runStreamTest = runStreamTest;

const params = new URLSearchParams(location.search);
if (params.has("selftest")) void runSelfTest();
if (params.has("streamtest")) void runStreamTest();
