// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Drive the sender UI orchestrator (src/ui/sender.ts) in jsdom. The QR renderer
// is mocked (canvas pixels are covered by render-scan.test.ts) and rAF is a
// no-op so the FramePlayer sets up without animating. The real core still builds
// the message, so encode/passphrase/kdf wiring is exercised for real.
vi.mock("../src/qr/render.js", () => ({
  renderUrToCanvas: vi.fn(),
  renderTextToCanvas: vi.fn(),
}));

import { renderTextToCanvas } from "../src/qr/render.js";

const DOM = `
  <label id="dropzone" for="file">Drop files</label>
  <input type="file" id="file" hidden />
  <input type="password" id="pass" />
  <div id="strength"></div>
  <label><input type="checkbox" id="argon" checked /> Stronger</label>
  <div id="passnote"></div>
  <div id="sizewarn"></div>
  <div id="caution"></div>
  <div id="stage" hidden>
    <canvas id="qr"></canvas>
    <div id="plan"></div>
    <div id="status"></div>
    <input type="range" id="rate" min="4" max="15" value="10" />
    <span id="rateVal">10</span>
    <input type="range" id="scale" min="3" max="10" value="6" />
    <span id="scaleVal">6</span>
    <button id="stop">Stop</button>
  </div>
  <canvas id="receiverqr"></canvas>
  <span id="receiverqrcap"></span>`;

function id<T extends HTMLElement>(x: string): T {
  return document.getElementById(x) as T;
}

function setFile(name: string, content: string, type = "text/plain"): void {
  const input = id<HTMLInputElement>("file");
  const file = new File([new TextEncoder().encode(content)], name, { type });
  const arr = [file] as unknown as FileList;
  Object.defineProperty(input, "files", { value: arr, configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function player(): { fps: number; scale: number; isRunning: boolean } {
  return (window as unknown as { blinkdropSender: { player: { fps: number; scale: number; isRunning: boolean } } })
    .blinkdropSender.player;
}

// Import sender.ts fresh against the current DOM (it wires listeners on import).
async function mountSender(): Promise<void> {
  vi.resetModules();
  document.body.innerHTML = DOM;
  await import("../src/ui/sender.js");
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.mocked(renderTextToCanvas).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sender UI", () => {
  it("renders the receiver-link QR on load", async () => {
    await mountSender();
    expect(renderTextToCanvas).toHaveBeenCalledTimes(1);
    expect(vi.mocked(renderTextToCanvas).mock.calls[0]?.[0]).toContain("receiver.html");
    expect(id("receiverqrcap").textContent).toBe("Open on phone");
  });

  it("a dropped plaintext file reveals the stage, shows the capture caution, then plays", async () => {
    await mountSender();
    setFile("hello.txt", "hi there");
    // set synchronously, before the async build
    expect(id("stage").hasAttribute("hidden")).toBe(false);
    expect(id("caution").textContent).toBe("Visible to anyone who can see the screen.");
    expect(id("status").textContent).toBe("Preparing…");
    await vi.waitFor(() => expect(player().isRunning).toBe(true));
    expect(id("plan").textContent).toContain("hello.txt");
    expect(id("plan").textContent).toContain("/ loop");
  });

  it("with a passphrase (Argon2id default) shows the stronger-encrypting status, no caution", async () => {
    await mountSender();
    id<HTMLInputElement>("pass").value = "correct horse battery";
    // #argon is checked by default (v0.10.1)
    setFile("secret.txt", "top secret");
    expect(id("status").textContent).toBe("Encrypting (stronger)…");
    expect(id("caution").textContent).toBe("");
  });

  it("unchecking the stronger-key box falls back to PBKDF2 status", async () => {
    await mountSender();
    id<HTMLInputElement>("pass").value = "pw";
    id<HTMLInputElement>("argon").checked = false;
    setFile("s.txt", "data");
    expect(id("status").textContent).toBe("Encrypting…");
  });

  it("shows a live passphrase-strength hint + the share-separately note", async () => {
    await mountSender();
    const pass = id<HTMLInputElement>("pass");
    pass.value = "abc";
    pass.dispatchEvent(new Event("input", { bubbles: true }));
    expect(id("strength").textContent).toBe("Strength: weak");
    expect(id("passnote").textContent).toBe("Share the passphrase separately.");
    pass.value = "correct-horse-battery-staple-99";
    pass.dispatchEvent(new Event("input", { bubbles: true }));
    expect(id("strength").textContent).toBe("Strength: strong");
    pass.value = "";
    pass.dispatchEvent(new Event("input", { bubbles: true }));
    expect(id("strength").textContent).toBe("");
  });

  it("rate + scale sliders update the player and their labels", async () => {
    await mountSender();
    const rate = id<HTMLInputElement>("rate");
    rate.value = "13";
    rate.dispatchEvent(new Event("input", { bubbles: true }));
    expect(player().fps).toBe(13);
    expect(id("rateVal").textContent).toBe("13");

    const scale = id<HTMLInputElement>("scale");
    scale.value = "9";
    scale.dispatchEvent(new Event("input", { bubbles: true }));
    expect(player().scale).toBe(9);
    expect(id("scaleVal").textContent).toBe("9");
  });

  it("Stop halts playback", async () => {
    await mountSender();
    setFile("a.txt", "content");
    await vi.waitFor(() => expect(player().isRunning).toBe(true));
    id<HTMLButtonElement>("stop").click();
    expect(player().isRunning).toBe(false);
    expect(id("status").textContent).toBe("Stopped.");
  });

  it("an empty file selection is a no-op", async () => {
    await mountSender();
    const input = id<HTMLInputElement>("file");
    Object.defineProperty(input, "files", { value: [] as unknown as FileList, configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(id("stage").hasAttribute("hidden")).toBe(true);
  });
});
