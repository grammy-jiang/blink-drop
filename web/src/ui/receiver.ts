import "../polyfill.js";
import {
  Assembler,
  DigestMismatchError,
  isEncryptedMessage,
  openMessage,
  WrongPassphraseError,
} from "../core/index.js";
import { CameraError, type CameraHandle, isSecureContextOk, startCamera } from "../receiver/camera.js";
import { shareOrDownload } from "../receiver/share.js";

// If a debug flag is present, load the M0 regression harness instead of the app.
const params = new URLSearchParams(location.search);
if (params.has("debug") || params.has("selftest") || params.has("streamtest")) {
  import("./debug.js").then((m) => m.mountDebug(document.getElementById("app") as HTMLElement));
} else {
  main();
}

const STALL_TIPS = [
  "Hold steady.",
  "Move closer, or reduce glare.",
  "Ask the sender to slow down or make the code bigger.",
];

function main(): void {
  const app = document.getElementById("app") as HTMLElement;

  let camera: CameraHandle | null = null;
  let assembler = new Assembler();
  let lastPercent = 0;
  let lastProgressAt = 0;

  const stopCamera = (): void => {
    camera?.stop();
    camera = null;
  };

  function renderReady(): void {
    stopCamera();
    app.innerHTML = `
      <div class="screen">
        <div class="hint">Point your phone at the animation on the other screen.</div>
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
    return `
      <div class="install" id="install">
        <span>Tip: <b>Share → Add to Home Screen</b> installs Blink-Drop so the camera opens reliably.</span>
        <button type="button" id="install-x" class="ghost" aria-label="Dismiss">✕</button>
      </div>`;
  }

  function renderInsecure(): void {
    stopCamera();
    app.innerHTML = `
      <div class="screen">
        <div class="loud">Open this page over <b>https</b> to use the camera.</div>
        <div class="hint">Safari blocks the camera on insecure connections. Use the hosted https link.</div>
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

  function renderCollecting(): HTMLElement {
    app.innerHTML = `
      <div class="screen">
        <div class="viewfinder" id="mount"><div class="target"></div></div>
        <div class="progress" id="progress">Point at the animation…</div>
        <div class="stall" id="stall"></div>
      </div>`;
    progressEl = app.querySelector("#progress");
    stallEl = app.querySelector("#stall");
    return app.querySelector("#mount") as HTMLElement;
  }

  function updateProgress(): void {
    if (!progressEl) return;
    const pct = assembler.percentComplete;
    const parts = assembler.expectedPartCount;
    if (pct <= 0 && parts <= 0) {
      progressEl.textContent = "Point at the animation…";
    } else {
      progressEl.textContent = `Collecting ${pct}%${parts > 0 ? ` · ~${parts} frames` : ""}`;
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

  async function startScanning(): Promise<void> {
    if (!isSecureContextOk()) {
      renderInsecure();
      return;
    }
    assembler = new Assembler();
    lastPercent = 0;
    lastProgressAt = Date.now();
    const mount = renderCollecting();
    try {
      camera = await startCamera(mount, (qr) => {
        if (qr !== null) assembler.receiveQr(qr);
        updateProgress();
        if (assembler.isSuccess) void finish();
      });
    } catch (e) {
      if (e instanceof CameraError && e.name === "InsecureContext") renderInsecure();
      else renderDenied(e instanceof CameraError ? cameraMessage(e) : String(e));
    }
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
      const decoded = await openMessage(message, { passphrase });
      renderComplete(
        decoded.header.name,
        decoded.bytes.length,
        decoded.header.mediaType,
        decoded.bytes,
        passphrase !== undefined,
      );
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

  function renderComplete(name: string, size: number, mediaType: string, bytes: Uint8Array, encrypted: boolean): void {
    app.innerHTML = `
      <div class="screen">
        <div class="card">
          <div class="badges">
            <div class="badge">✓ Verified</div>
            ${encrypted ? `<div class="badge lock">🔒 Encrypted</div>` : ""}
          </div>
          <div class="fname" id="fname"></div>
          <div class="meta" id="meta"></div>
          ${
            encrypted
              ? `<div class="meta enc-note">Content and file name were hidden from anyone without the passphrase. The size, and that a transfer happened, were not.</div>`
              : ""
          }
          <div class="actions">
            <button type="button" id="share" class="primary">Share</button>
            <button type="button" id="save">Save</button>
            <button type="button" id="discard" class="ghost">Discard</button>
          </div>
          <div class="shareresult" id="shareresult"></div>
        </div>
      </div>`;
    (app.querySelector("#fname") as HTMLElement).textContent = name;
    (app.querySelector("#meta") as HTMLElement).textContent = `${formatBytes(size)} · ${mediaType || "file"}`;
    const shareResult = app.querySelector("#shareresult") as HTMLElement;
    (app.querySelector("#share") as HTMLButtonElement).addEventListener("click", async () => {
      const r = await shareOrDownload(bytes, name, mediaType);
      shareResult.textContent = r === "cancelled" ? "" : r === "shared" ? "Shared." : "Saved to downloads.";
    });
    (app.querySelector("#save") as HTMLButtonElement).addEventListener("click", async () => {
      await shareOrDownload(bytes, name, mediaType);
      shareResult.textContent = "Saved.";
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

  // Boot: secure-context gate, then Ready.
  if (!isSecureContextOk()) renderInsecure();
  else renderReady();
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
