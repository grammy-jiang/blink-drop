import "../polyfill.js";
import { buildMessage, DEFAULT_MAX_FRAGMENT_LENGTH, qrPartStream, systematicQrParts } from "../core/index.js";
import { FramePlayer } from "../player/loop.js";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

const fileInput = el<HTMLInputElement>("file");
const planEl = el<HTMLDivElement>("plan");
const statusEl = el<HTMLDivElement>("status");
const canvas = el<HTMLCanvasElement>("qr");
const rate = el<HTMLInputElement>("rate");
const rateVal = el<HTMLSpanElement>("rateVal");
const scale = el<HTMLInputElement>("scale");
const scaleVal = el<HTMLSpanElement>("scaleVal");
const stopBtn = el<HTMLButtonElement>("stop");

const player = new FramePlayer(canvas, { fps: Number(rate.value), scale: Number(scale.value) });
let seqLen = 0;

player.onFrame = (info) => {
  statusEl.textContent = `Playing · cycle ${info.cycles + 1} · frame ${info.index + 1}/${info.total}`;
};

function updateEta(): void {
  if (seqLen === 0) return;
  const eta = Math.ceil(seqLen / player.fps);
  planEl.dataset.eta = String(eta);
  const base = planEl.dataset.base ?? "";
  planEl.textContent = `${base} · ~${eta}s per pass — keep playing until the phone shows Verified`;
}

rate.addEventListener("input", () => {
  player.fps = Number(rate.value);
  rateVal.textContent = rate.value;
  updateEta();
});
scale.addEventListener("input", () => {
  player.scale = Number(scale.value);
  scaleVal.textContent = scale.value;
});
stopBtn.addEventListener("click", () => {
  player.stop();
  statusEl.textContent = "Stopped.";
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  statusEl.textContent = "Preparing…";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const input = { bytes, name: file.name, mediaType: file.type || "application/octet-stream" };

  const message = await buildMessage(input);
  seqLen = systematicQrParts(message, DEFAULT_MAX_FRAGMENT_LENGTH).length;
  // Loop the systematic parts plus a redundancy set of fountain parts (blueprint L5/§7).
  const parts = qrPartStream(message, Math.ceil(seqLen * 1.5), DEFAULT_MAX_FRAGMENT_LENGTH);

  planEl.dataset.base = `${input.name} · ${bytes.length} B · ${seqLen} frames`;
  updateEta();

  player.load(parts);
  player.stop();
  player.start();
});

// Expose for automated testing / debugging.
(window as unknown as { blinkdropSender: unknown }).blinkdropSender = { player };
