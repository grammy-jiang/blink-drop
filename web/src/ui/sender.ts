import "../polyfill.js";
import {
  buildFilesMessage,
  DEFAULT_MAX_FRAGMENT_LENGTH,
  type FileInput,
  qrPartStream,
  systematicQrParts,
} from "../core/index.js";
import { FramePlayer } from "../player/loop.js";
import { renderTextToCanvas } from "../qr/render.js";
import { describeSize } from "./size.js";

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
const passInput = el<HTMLInputElement>("pass");
const passNote = el<HTMLDivElement>("passnote");
const argonBox = el<HTMLInputElement>("argon");
const strengthEl = el<HTMLDivElement>("strength");
const sizeWarnEl = el<HTMLDivElement>("sizewarn");
const cautionEl = el<HTMLDivElement>("caution");
const stageEl = el<HTMLDivElement>("stage");
const dropzone = el<HTMLElement>("dropzone");

const player = new FramePlayer(canvas, { fps: Number(rate.value), scale: Number(scale.value) });
let seqLen = 0;

player.onFrame = (info) => {
  statusEl.textContent = `Playing · loop ${info.cycles + 1}`;
};

function updateEta(): void {
  if (seqLen === 0) return;
  const eta = Math.ceil(seqLen / player.fps);
  planEl.dataset.eta = String(eta);
  const base = planEl.dataset.base ?? "";
  planEl.textContent = `${base} · ~${eta}s / loop`;
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

// Honest, non-fabricated copy: state what encryption does and does NOT hide. The
// passphrase itself never leaves this field — it is only fed to buildMessage to
// derive the key, never stored, never put in the QR or the plan text.
function updatePassNote(): void {
  passNote.textContent = passInput.value ? "Share the passphrase separately." : "";
}

// A rough, library-free strength hint — deliberately honest that it is only a
// hint. Estimates entropy as length × log2(alphabet-from-character-classes).
function updateStrength(): void {
  const pw = passInput.value;
  if (!pw) {
    strengthEl.textContent = "";
    return;
  }
  let classes = 0;
  if (/[a-z]/.test(pw)) classes++;
  if (/[A-Z]/.test(pw)) classes++;
  if (/[0-9]/.test(pw)) classes++;
  if (/[^a-zA-Z0-9]/.test(pw)) classes++;
  const alphabet = [0, 26, 52, 62, 95][classes] ?? 26;
  const bits = pw.length * Math.log2(alphabet);
  const label = bits < 40 ? "weak" : bits < 70 ? "ok" : "strong";
  strengthEl.textContent = `Strength: ${label}`;
  strengthEl.title = "Rough hint. A captured transfer can be attacked offline — longer is safer.";
}

passInput.addEventListener("input", () => {
  updatePassNote();
  updateStrength();
});

// Shared by click-to-pick and drag-and-drop. One file → the single-file envelope;
// several → the multi-file envelope (buildFilesMessage). Optional passphrase.
async function processFiles(files: File[]): Promise<void> {
  if (files.length === 0) return;
  const passphrase = passInput.value || undefined;
  // Argon2id (memory-hard) is the default for encrypted sends — the #argon box is
  // checked by default (v0.10.1). Unchecking it opts down to PBKDF2 (undefined →
  // core's PBKDF2 default) for a faster, GPU-weaker key. Only relevant with a passphrase.
  const kdf = passphrase && argonBox.checked ? "argon2id" : undefined;
  // Reveal the playing stage; show the visible-capture caution only for an
  // unencrypted send (honest exactly when it matters — docs/18 D3).
  stageEl.hidden = false;
  cautionEl.textContent = passphrase ? "" : "Visible to anyone who can see the screen.";
  statusEl.textContent = passphrase ? (kdf ? "Encrypting (stronger)…" : "Encrypting…") : "Preparing…";

  const inputs: FileInput[] = [];
  let totalBytes = 0;
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    totalBytes += bytes.length;
    inputs.push({ bytes, name: file.name, mediaType: file.type || "application/octet-stream" });
  }
  sizeWarnEl.textContent = describeSize(totalBytes).warn; // combined-size ceiling — advisory, never blocks

  let message: Uint8Array;
  try {
    message = await buildFilesMessage(inputs, { passphrase, kdf });
  } catch (e) {
    statusEl.textContent = `Couldn't prepare: ${(e as Error).message}`;
    return;
  }
  seqLen = systematicQrParts(message, DEFAULT_MAX_FRAGMENT_LENGTH).length;
  // Loop the systematic parts plus a redundancy set of fountain parts (blueprint L5/§7).
  const parts = qrPartStream(message, Math.ceil(seqLen * 1.5), DEFAULT_MAX_FRAGMENT_LENGTH);

  const label = inputs.length === 1 ? inputs[0]!.name : `${inputs.length} files`;
  planEl.dataset.base = label; // minimal — updateEta appends "· ~Ns / loop"
  updateEta();

  player.load(parts);
  player.stop();
  player.start();
}

fileInput.addEventListener("change", () => {
  const files = fileInput.files ? [...fileInput.files] : [];
  if (files.length) void processFiles(files);
});

// Drag-and-drop onto the zone runs the same path (blueprint §9 In-list).
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  const files = e.dataTransfer?.files ? [...e.dataTransfer.files] : [];
  if (files.length) void processFiles(files);
});

// Render a static QR of the receiver page URL so the phone can open the PWA by
// scanning it — no typing a URL on the phone.
const receiverCanvas = document.getElementById("receiverqr") as HTMLCanvasElement | null;
if (receiverCanvas) {
  renderTextToCanvas(new URL("receiver.html", location.href).href, receiverCanvas, { scale: 4, margin: 3 });
  const cap = document.getElementById("receiverqrcap");
  if (cap) cap.textContent = "Open on phone";
}

// Expose for automated testing / debugging.
(window as unknown as { blinkdropSender: unknown }).blinkdropSender = { player };
