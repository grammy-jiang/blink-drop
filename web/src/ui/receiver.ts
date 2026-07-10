import "../polyfill.js";
import {
  Assembler,
  type DecodedFile,
  DigestMismatchError,
  isEncryptedMessage,
  openFilesMessage,
  WrongPassphraseError,
} from "../core/index.js";
import { zipFiles } from "../receiver/bundle.js";
import {
  CameraError,
  type CameraHandle,
  type CameraStats,
  isSecureContextOk,
  startCamera,
} from "../receiver/camera.js";
import { safeName } from "../receiver/filename.js";
import {
  clear as clearResume,
  load as loadResume,
  type ResumePartial,
  save as saveResume,
} from "../receiver/resume.js";
import { downloadFile, shareOrDownload, shareOrDownloadMany } from "../receiver/share.js";

// If a debug flag is present, load the M0 regression harness instead of the app.
const params = new URLSearchParams(location.search);
if (params.has("debug") || params.has("selftest") || params.has("streamtest") || params.has("loopback")) {
  import("./debug.js").then((m) => m.mountDebug(document.getElementById("app") as HTMLElement));
} else {
  main();
}

const STALL_TIPS = [
  "Hold steady.",
  "Move closer, or reduce glare.",
  "Ask the sender to slow down or make the code bigger.",
];

// Only persist transfers big enough that resume helps (docs/11 D6). Small ones
// finish in seconds, so they never touch disk.
const RESUME_MIN_FRAMES = 40;

// The Chromium-only install-prompt event (Android + desktop Chrome), not yet in
// lib.dom. iOS Safari never fires it — there we show the Add-to-Home-Screen tip.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function main(): void {
  const app = document.getElementById("app") as HTMLElement;

  let camera: CameraHandle | null = null;
  let assembler = new Assembler();
  let lastPercent = 0;
  let lastProgressAt = 0;
  let receivedParts = new Set<string>();
  let lastSaveAt = 0;

  // Chromium (Android/desktop) fires beforeinstallprompt when the PWA is
  // installable; capture it to offer a real one-tap Install button. iOS Safari
  // never fires it → the Share → Add to Home Screen tip is used there instead.
  let installPrompt: BeforeInstallPromptEvent | null = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e as BeforeInstallPromptEvent;
    if (app.querySelector("#start")) renderReady(); // refresh Ready → show the button
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    (app.querySelector("#install") as HTMLElement | null)?.remove();
  });

  const stopCamera = (): void => {
    camera?.stop();
    camera = null;
  };

  function renderReady(): void {
    stopCamera();
    app.innerHTML = `
      <div class="screen">
        <h1 class="brand">Blink-Drop</h1>
        <div class="hint">Point your phone at the animation.</div>
        <button type="button" id="start" class="primary">Start scanning</button>
        ${installHintHtml()}
      </div>`;
    (app.querySelector("#start") as HTMLButtonElement).addEventListener("click", () => void startScanning());
    const dismiss = app.querySelector("#install-x");
    if (dismiss) {
      dismiss.addEventListener("click", () => {
        try {
          sessionStorage.setItem("bd-hide-install", "1");
        } catch {}
        (app.querySelector("#install") as HTMLElement | null)?.remove();
      });
    }
    const installGo = app.querySelector("#install-go");
    if (installGo) {
      installGo.addEventListener("click", async () => {
        if (!installPrompt) return;
        await installPrompt.prompt();
        await installPrompt.userChoice.catch(() => undefined);
        installPrompt = null; // the prompt can only be used once
        (app.querySelector("#install") as HTMLElement | null)?.remove();
      });
    }
  }

  // Offered on boot when an interrupted transfer was persisted (docs/11). Resume
  // replays the saved parts; Start fresh clears them.
  function renderResumeOffer(partial: ResumePartial): void {
    stopCamera();
    app.innerHTML = `
      <div class="screen">
        <div class="hint">Interrupted at <b>${partial.percent}%</b>. Point at the same animation to continue.</div>
        <div class="actions">
          <button type="button" id="resume" class="primary">Resume (${partial.percent}%)</button>
          <button type="button" id="fresh" class="ghost">Start fresh</button>
        </div>
      </div>`;
    (app.querySelector("#resume") as HTMLButtonElement).addEventListener(
      "click",
      () => void startScanning(partial.parts),
    );
    (app.querySelector("#fresh") as HTMLButtonElement).addEventListener("click", () => {
      void clearResume();
      renderReady();
    });
  }

  // On iOS the camera is most reliable from an installed (standalone) PWA. Show a
  // dismissible "Add to Home Screen" tip only when running in a browser tab.
  function installHintHtml(): string {
    const nav = navigator as { standalone?: boolean };
    const standalone = nav.standalone === true || matchMedia("(display-mode: standalone)").matches;
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem("bd-hide-install") === "1";
    } catch {}
    if (standalone || dismissed) return "";
    // Chromium (Android/desktop): a real one-tap Install button from the captured
    // beforeinstallprompt — the reliable install path on Android.
    if (installPrompt) {
      return `
        <div class="install" id="install">
          <span>Install Blink-Drop so the camera opens reliably.</span>
          <button type="button" id="install-go" class="primary">Install</button>
          <button type="button" id="install-x" class="ghost" aria-label="Dismiss">✕</button>
        </div>`;
    }
    // iOS Safari (never fires beforeinstallprompt): the Share → Add to Home Screen flow.
    const isIOS =
      /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIOS) {
      return `
        <div class="install" id="install">
          <span>Tip: <b>Share → Add to Home Screen</b> for a reliable camera.</span>
          <button type="button" id="install-x" class="ghost" aria-label="Dismiss">✕</button>
        </div>`;
    }
    // Anywhere we can neither prompt nor give correct steps → show nothing, rather
    // than another platform's (wrong) instructions.
    return "";
  }

  function renderInsecure(): void {
    stopCamera();
    app.innerHTML = `
      <div class="screen">
        <div class="loud">Open this page over <b>https</b> to use the camera.</div>
        <div class="hint">The camera needs a secure (https) connection.</div>
      </div>`;
  }

  function renderDenied(message: string): void {
    stopCamera();
    app.innerHTML = `
      <div class="screen">
        <div class="loud">Camera unavailable</div>
        <div class="hint" id="why"></div>
        <button type="button" id="retry" class="primary">Try again</button>
      </div>`;
    (app.querySelector("#why") as HTMLElement).textContent = message;
    (app.querySelector("#retry") as HTMLButtonElement).addEventListener("click", () => void startScanning());
  }

  // Collecting screen keeps a live <video> preview, so it renders once and then
  // only its progress/stall text is updated per frame.
  let progressEl: HTMLElement | null = null;
  let stallEl: HTMLElement | null = null;
  let capsEl: HTMLElement | null = null;

  function renderCollecting(): HTMLElement {
    app.innerHTML = `
      <div class="screen">
        <div class="viewfinder" id="mount"><div class="target"></div></div>
        <div class="progress" id="progress">Point at the animation…</div>
        <div class="stall" id="stall"></div>
        <div class="caps" id="caps"></div>
      </div>`;
    progressEl = app.querySelector("#progress");
    stallEl = app.querySelector("#stall");
    capsEl = app.querySelector("#caps");
    return app.querySelector("#mount") as HTMLElement;
  }

  // The receiver's measured capability. Devices have no back-channel, so this is
  // shown to the human, who keeps the sender's speed ≤ ~½ the scan rate (docs/23).
  function formatCaps(s: CameraStats): string {
    const res =
      s.height >= 1080 ? "1080p" : s.height >= 720 ? "720p" : s.height >= 480 ? "480p" : `${s.width}×${s.height}`;
    const senderMax = Math.max(1, Math.floor(s.scanFps / 2));
    return `${res} · scan ~${Math.round(s.scanFps)} fps · keep sender ≤ ${senderMax}`;
  }

  function updateProgress(): void {
    if (!progressEl) return;
    const pct = assembler.percentComplete;
    const parts = assembler.expectedPartCount;
    if (pct <= 0 && parts <= 0) {
      progressEl.textContent = "Point at the animation…";
    } else {
      progressEl.textContent = `Collecting ${Math.round(pct * 100)}%${parts > 0 ? ` · ~${parts} frames` : ""}`;
    }
    // Stall detection: no percent gain for a while → escalate guidance.
    const now = Date.now();
    if (pct > lastPercent) {
      lastPercent = pct;
      lastProgressAt = now;
      if (stallEl) stallEl.textContent = "";
    } else if (stallEl && lastProgressAt > 0) {
      const stalledSec = (now - lastProgressAt) / 1000;
      if (stalledSec > 3) {
        stallEl.textContent = STALL_TIPS[Math.min(STALL_TIPS.length - 1, Math.floor(stalledSec / 3) - 1)] ?? "";
      }
    }
  }

  async function startScanning(seedParts?: string[]): Promise<void> {
    if (!isSecureContextOk()) {
      renderInsecure();
      return;
    }
    assembler = new Assembler();
    receivedParts = new Set();
    lastSaveAt = 0;
    lastPercent = 0;
    lastProgressAt = Date.now();
    // Resume: replay the persisted parts into the fresh assembler before scanning.
    if (seedParts) {
      for (const p of seedParts) if (assembler.receiveQr(p)) receivedParts.add(p);
    }
    const mount = renderCollecting();
    updateProgress();
    if (assembler.isSuccess) {
      void finish();
      return;
    }
    try {
      camera = await startCamera(
        mount,
        (qr) => {
          if (qr !== null && assembler.receiveQr(qr)) receivedParts.add(qr);
          updateProgress();
          persistMaybe();
          if (assembler.isSuccess) void finish();
        },
        (stats) => {
          if (capsEl) capsEl.textContent = formatCaps(stats);
        },
      );
    } catch (e) {
      if (e instanceof CameraError && e.name === "InsecureContext") renderInsecure();
      else renderDenied(e instanceof CameraError ? cameraMessage(e) : String(e));
    }
  }

  // Persist the partial (encrypted at rest, docs/11) so an interrupted scan can
  // resume. Only for large transfers (D6), debounced to ~1s.
  function persistMaybe(): void {
    if (assembler.isSuccess || assembler.expectedPartCount <= RESUME_MIN_FRAMES) return;
    const now = Date.now();
    if (now - lastSaveAt < 1000) return;
    lastSaveAt = now;
    void saveResume({
      parts: [...receivedParts],
      percent: Math.round(assembler.percentComplete * 100), // percentComplete is a 0–1 fraction
      frames: assembler.expectedPartCount,
      savedAt: now,
    });
  }

  async function finish(): Promise<void> {
    stopCamera();
    const message = assembler.message();
    // Encrypted streams are detectable from the assembled message, so we can ask
    // for the passphrase before attempting to verify rather than after.
    if (isEncryptedMessage(message)) {
      renderPassphrase(message);
      return;
    }
    await verifyAndComplete(message, undefined);
  }

  async function verifyAndComplete(message: Uint8Array, passphrase: string | undefined): Promise<void> {
    app.innerHTML = `<div class="screen"><div class="hint">Verifying…</div></div>`;
    try {
      const files = await openFilesMessage(message, { passphrase });
      void clearResume(); // verified → drop the persisted partial
      renderComplete(files, passphrase !== undefined);
    } catch (e) {
      // A wrong passphrase is NOT a corruption failure — re-prompt, keep the file
      // withheld, do not offer "accept anyway".
      if (e instanceof WrongPassphraseError) {
        renderPassphrase(message, "That passphrase didn't work.");
        return;
      }
      const withheld =
        e instanceof DigestMismatchError
          ? "Couldn't verify the file — nothing was saved."
          : `Transfer failed — nothing was saved.`;
      renderFailed(withheld);
    }
  }

  function renderPassphrase(message: Uint8Array, error?: string): void {
    app.innerHTML = `
      <div class="screen">
        <div class="hint">🔒 This transfer is encrypted. Enter the passphrase the sender gave you.</div>
        <input type="password" id="pp" class="pp" autocomplete="off" spellcheck="false" />
        <div class="loud" id="pperr"></div>
        <div class="actions">
          <button type="button" id="ppgo" class="primary">Unlock</button>
          <button type="button" id="ppcancel" class="ghost">Start over</button>
        </div>
      </div>`;
    const input = app.querySelector("#pp") as HTMLInputElement;
    const err = app.querySelector("#pperr") as HTMLElement;
    err.textContent = error ?? "";
    const submit = (): void => {
      if (!input.value) {
        err.textContent = "Enter the passphrase.";
        return;
      }
      void verifyAndComplete(message, input.value);
    };
    (app.querySelector("#ppgo") as HTMLButtonElement).addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    (app.querySelector("#ppcancel") as HTMLButtonElement).addEventListener("click", renderReady);
    input.focus();
  }

  function renderComplete(files: DecodedFile[], encrypted: boolean): void {
    const single = files.length === 1;
    const total = files.reduce((n, f) => n + f.bytes.length, 0);
    app.innerHTML = `
      <div class="screen">
        <div class="card">
          <div class="badges">
            <div class="badge">✓ Verified</div>
            ${encrypted ? `<div class="badge lock">🔒 Encrypted</div>` : ""}
          </div>
          <div class="fname" id="fname"></div>
          <div class="meta" id="meta"></div>
          ${single ? "" : `<ul class="filelist" id="filelist"></ul>`}
          ${
            encrypted
              ? `<div class="meta enc-note">Name${single ? "" : "s"} and content were hidden from anyone without the passphrase — but not the size, or that a transfer happened.</div>`
              : ""
          }
          <div class="actions">
            <button type="button" id="share" class="primary">${single ? "Share" : "Share all"}</button>
            ${single ? "" : `<button type="button" id="sharezip">Share .zip</button>`}
            <button type="button" id="save">${single ? "Save" : "Save .zip"}</button>
            <button type="button" id="discard" class="ghost">Discard</button>
          </div>
          <div class="shareresult" id="shareresult"></div>
        </div>
      </div>`;
    // Filenames go in via textContent / DOM nodes — never innerHTML (a hostile
    // sender controls the names, so this keeps the no-XSS invariant).
    (app.querySelector("#fname") as HTMLElement).textContent = single
      ? safeName(files[0]!.header.name)
      : `${files.length} files`;
    (app.querySelector("#meta") as HTMLElement).textContent = single
      ? `${formatBytes(files[0]!.bytes.length)} · ${files[0]!.header.mediaType || "file"}`
      : `${files.length} files · ${formatBytes(total)}`;
    if (!single) {
      const list = app.querySelector("#filelist") as HTMLElement;
      for (const f of files) {
        const li = document.createElement("li");
        li.textContent = `${safeName(f.header.name)} · ${formatBytes(f.bytes.length)}`;
        list.appendChild(li);
      }
    }
    const items = files.map((f) => ({ bytes: f.bytes, name: safeName(f.header.name), mediaType: f.header.mediaType }));
    const shareResult = app.querySelector("#shareresult") as HTMLElement;
    // Share the file(s) individually via the OS share sheet — a single file, or
    // "Share all" for a multi-file set (each file shared separately).
    (app.querySelector("#share") as HTMLButtonElement).addEventListener("click", async () => {
      const r = await shareOrDownloadMany(items);
      shareResult.textContent = r === "cancelled" ? "" : r === "shared" ? "Shared." : "Saved to downloads.";
    });
    // Multi-file only: an ALTERNATIVE to "Share all" — bundle the verified files
    // into ONE .zip and share that via the share sheet. A single-file Web Share
    // is reliable on iOS where multi-file share is not (real-device finding), so
    // this is the dependable way to send the set to Messages / Mail / AirDrop.
    const shareZipBtn = app.querySelector("#sharezip") as HTMLButtonElement | null;
    if (shareZipBtn) {
      shareZipBtn.addEventListener("click", async () => {
        const zip = zipFiles(items.map((i) => ({ name: i.name, bytes: i.bytes })));
        const r = await shareOrDownload(zip, `blink-drop-${files.length}-files.zip`, "application/zip");
        shareResult.textContent = r === "cancelled" ? "" : r === "shared" ? "Shared." : "Saved to downloads.";
      });
    }
    (app.querySelector("#save") as HTMLButtonElement).addEventListener("click", async () => {
      if (single) {
        await shareOrDownloadMany(items);
        shareResult.textContent = "Saved.";
        return;
      }
      // Multi-file: bundle into one .zip — the one shape iOS Files saves + unzips
      // reliably, where per-file share/download is flaky (docs/14).
      const zip = zipFiles(items.map((i) => ({ name: i.name, bytes: i.bytes })));
      downloadFile(zip, `blink-drop-${files.length}-files.zip`, "application/zip");
      shareResult.textContent = "Saved .zip.";
    });
    (app.querySelector("#discard") as HTMLButtonElement).addEventListener("click", renderReady);
  }

  function renderFailed(message: string): void {
    stopCamera();
    app.innerHTML = `
      <div class="screen">
        <div class="loud" id="msg"></div>
        <div class="actions">
          <button type="button" id="rescan" class="primary">Keep scanning</button>
          <button type="button" id="restart" class="ghost">Restart</button>
        </div>
      </div>`;
    (app.querySelector("#msg") as HTMLElement).textContent = message;
    (app.querySelector("#rescan") as HTMLButtonElement).addEventListener("click", () => void startScanning());
    (app.querySelector("#restart") as HTMLButtonElement).addEventListener("click", renderReady);
  }

  // Boot: secure-context gate, then offer resume (if a partial exists) or Ready.
  if (!isSecureContextOk()) {
    renderInsecure();
  } else {
    void bootReady();
  }

  async function bootReady(): Promise<void> {
    const partial = await loadResume().catch(() => null);
    if (partial && partial.parts.length > 0) renderResumeOffer(partial);
    else renderReady();
  }
}

function cameraMessage(e: CameraError): string {
  switch (e.name) {
    case "PermissionDenied":
      return "Camera permission was denied. Enable it in your browser/site settings, then try again.";
    case "NoCamera":
      return "No usable camera was found.";
    default:
      return "The camera could not be started.";
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
