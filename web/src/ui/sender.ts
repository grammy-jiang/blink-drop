import "../polyfill.js";
import { buildMessage, DEFAULT_MAX_FRAGMENT_LENGTH, qrPartStream, systematicQrParts } from "../core/index.js";
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
const dropzone = el<HTMLDivElement>("dropzone");

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

// Honest, non-fabricated copy: state what encryption does and does NOT hide. The
// passphrase itself never leaves this field — it is only fed to buildMessage to
// derive the key, never stored, never put in the QR or the plan text.
function updatePassNote(): void {
  passNote.textContent = passInput.value
    ? "🔒 Encrypted — the receiver must enter this passphrase. Share it separately (not on screen). The file size and that a transfer happened are still visible."
    : "";
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
  strengthEl.textContent = `Strength: ${label} — a rough hint; a captured transfer can be attacked offline, so longer is safer.`;
}

passInput.addEventListener("input", () => {
  updatePassNote();
  updateStrength();
});

// Shared by click-to-pick and drag-and-drop.
async function processFile(file: File): Promise<void> {
  const passphrase = passInput.value || undefined;
  const kdf = passphrase && argonBox.checked ? "argon2id" : undefined;
  statusEl.textContent = passphrase ? (kdf ? "Encrypting (stronger)…" : "Encrypting…") : "Preparing…";
  const bytes = new Uint8Array(await file.arrayBuffer());
  sizeWarnEl.textContent = describeSize(bytes.length).warn; // soft/hard ceiling — advisory, never blocks
  const input = { bytes, name: file.name, mediaType: file.type || "application/octet-stream" };

  const message = await buildMessage(input, { passphrase, kdf });
  seqLen = systematicQrParts(message, DEFAULT_MAX_FRAGMENT_LENGTH).length;
  // Loop the systematic parts plus a redundancy set of fountain parts (blueprint L5/§7).
  const parts = qrPartStream(message, Math.ceil(seqLen * 1.5), DEFAULT_MAX_FRAGMENT_LENGTH);

  planEl.dataset.base = `${input.name} · ${bytes.length} B · ${seqLen} frames`;
  updateEta();

  player.load(parts);
  player.stop();
  player.start();
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void processFile(file);
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
  const file = e.dataTransfer?.files?.[0];
  if (file) void processFile(file);
});

// Render a static QR of the receiver page URL so the phone can open the PWA by
// scanning it — no typing a URL on the phone.
const receiverBox = document.getElementById("receiverqrbox");
const receiverCanvas = document.getElementById("receiverqr") as HTMLCanvasElement | null;
if (receiverBox && receiverCanvas) {
  renderTextToCanvas(new URL("receiver.html", location.href).href, receiverCanvas, { scale: 4, margin: 3 });
  const cap = document.getElementById("receiverqrcap");
  if (cap) cap.textContent = "Scan to open the receiver on your phone";
  receiverBox.removeAttribute("hidden");
}

// Expose for automated testing / debugging.
(window as unknown as { blinkdropSender: unknown }).blinkdropSender = { player };
