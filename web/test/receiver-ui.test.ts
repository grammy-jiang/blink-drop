// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuildOptions, FileInput } from "../src/core/index.js";
import { buildFilesMessage, buildMessage, DEFAULT_MAX_FRAGMENT_LENGTH, systematicQrParts } from "../src/core/index.js";

// Drive the receiver UI orchestrator (src/ui/receiver.ts) in jsdom. The camera
// module is mocked so tests feed real encoded UR frames through its onFrame
// callback (as the manual browser E2E did via getUserMedia), and the resume
// module is mocked to dodge IndexedDB. The real core does the reconstruct +
// SHA-256 verify + decrypt, so the whole scan→verify→share path is exercised.

const cam = vi.hoisted(() => ({
  secure: true,
  throwOnStart: null as Error | null,
  onFrame: null as ((qr: string | null) => void) | null,
  stopped: false,
}));

vi.mock("../src/receiver/camera.js", () => ({
  isSecureContextOk: () => cam.secure,
  CameraError: class CameraError extends Error {
    constructor(
      public override readonly name: string,
      message: string,
    ) {
      super(message);
    }
  },
  startCamera: async (_mount: HTMLElement, onFrame: (qr: string | null) => void) => {
    if (cam.throwOnStart) throw cam.throwOnStart;
    cam.onFrame = onFrame;
    cam.stopped = false;
    return { video: document.createElement("video"), stop: () => (cam.stopped = true) };
  },
}));

const res = vi.hoisted(() => ({ partial: null as unknown }));
vi.mock("../src/receiver/resume.js", () => ({
  load: async () => res.partial,
  save: async () => {},
  clear: async () => {
    res.partial = null;
  },
}));

const app = () => document.getElementById("app") as HTMLElement;
const q = (sel: string) => app().querySelector(sel) as HTMLElement | null;
const txt = () => (app().textContent ?? "").replace(/\s+/g, " ").trim();

async function mountReceiver(): Promise<void> {
  vi.resetModules();
  cam.onFrame = null;
  cam.throwOnStart = null;
  cam.secure = true;
  document.body.innerHTML = `<main id="app"></main>`;
  await import("../src/ui/receiver.js");
  await vi.waitFor(() => expect(q("#start") || q(".loud") || q("#resume")).toBeTruthy());
}

async function scanToComplete(inputs: FileInput[]): Promise<void> {
  q("#start")?.click();
  await vi.waitFor(() => expect(q("#progress")).toBeTruthy());
  feed(await frames(inputs));
  await vi.waitFor(() => expect(q(".card")).toBeTruthy());
}

async function frames(inputs: FileInput[], opts?: BuildOptions): Promise<string[]> {
  const msg =
    inputs.length === 1 && !opts ? await buildMessage(inputs[0]!) : await buildFilesMessage(inputs, opts ?? {});
  return systematicQrParts(msg, DEFAULT_MAX_FRAGMENT_LENGTH);
}

function feed(parts: string[]): void {
  for (const p of parts) cam.onFrame?.(p);
}

function file(name: string, content: string, mediaType = "text/plain"): FileInput {
  // Uint8Array.from (not jsdom's TextEncoder) so the bytes are the shared-realm
  // Uint8Array that core's `instanceof Uint8Array` checks expect.
  return { bytes: Uint8Array.from(content, (c) => c.charCodeAt(0)), name, mediaType };
}

// Simulate an accepted OS share sheet.
function stubShareAccept(): { count: number } {
  const rec = { count: 0 };
  Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
  Object.defineProperty(navigator, "share", {
    value: (d: { files: File[] }) => {
      rec.count += d.files.length;
      return Promise.resolve();
    },
    configurable: true,
  });
  return rec;
}

beforeEach(() => {
  res.partial = null;
  // jsdom lacks matchMedia (used by the install-hint standalone check).
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }),
  });
  // URL object-URL for the save/download fallback.
  const u = URL as unknown as { createObjectURL: () => string; revokeObjectURL: () => void };
  u.createObjectURL = () => "blob:mock";
  u.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const k of ["share", "canShare"]) {
    Object.defineProperty(navigator, k, { value: undefined, configurable: true });
  }
});

describe("receiver UI — boot + scan → verify", () => {
  it("boots to the Ready screen", async () => {
    await mountReceiver();
    expect(q("#start")).toBeTruthy();
    expect(txt()).toContain("Point your phone at the animation");
  });

  it("scans a plaintext file to the Verified complete card", async () => {
    await mountReceiver();
    q("#start")?.click();
    await vi.waitFor(() => expect(q("#progress")).toBeTruthy()); // Collecting
    feed(await frames([file("hello.txt", "hi there world")]));
    await vi.waitFor(() => expect(q(".card")).toBeTruthy());
    expect(q(".badge")?.textContent).toContain("Verified");
    expect(q("#fname")?.textContent).toBe("hello.txt");
    expect(q("#meta")?.textContent).toContain("text/plain");
    // Scan timer: we received frames, so the receive time is shown.
    expect(q("#rxtime")?.textContent).toContain("Received in");
  });

  it("shares the verified file via the OS sheet", async () => {
    await mountReceiver();
    q("#start")?.click();
    await vi.waitFor(() => expect(q("#progress")).toBeTruthy());
    feed(await frames([file("doc.txt", "content here")]));
    await vi.waitFor(() => expect(q(".card")).toBeTruthy());
    const rec = stubShareAccept();
    (q("#share") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(q("#shareresult")?.textContent).toBe("Shared."));
    expect(rec.count).toBe(1);
  });

  it("discard returns to Ready", async () => {
    await mountReceiver();
    q("#start")?.click();
    await vi.waitFor(() => expect(q("#progress")).toBeTruthy());
    feed(await frames([file("x.txt", "y")]));
    await vi.waitFor(() => expect(q(".card")).toBeTruthy());
    (q("#discard") as HTMLButtonElement).click();
    expect(q("#start")).toBeTruthy();
  });
});

describe("receiver UI — multi-file", () => {
  it("shows an N-files card with Share all / Share .zip / Save .zip", async () => {
    await mountReceiver();
    q("#start")?.click();
    await vi.waitFor(() => expect(q("#progress")).toBeTruthy());
    feed(await frames([file("a.txt", "aaaa"), file("b.txt", "bbbb")]));
    await vi.waitFor(() => expect(q(".card")).toBeTruthy());
    expect(q("#fname")?.textContent).toBe("2 files");
    const labels = [...app().querySelectorAll(".actions button")].map((b) => b.textContent);
    expect(labels).toEqual(["Share all", "Share .zip", "Save .zip", "Discard"]);
  });
});

describe("receiver UI — encrypted", () => {
  it("prompts for a passphrase, rejects the wrong one, then unlocks", async () => {
    await mountReceiver();
    const parts = await frames([file("secret.txt", "classified")], { passphrase: "hunter2" });
    q("#start")?.click();
    await vi.waitFor(() => expect(q("#progress")).toBeTruthy());
    feed(parts);
    await vi.waitFor(() => expect(q("#pp")).toBeTruthy()); // passphrase screen
    // wrong passphrase
    (q("#pp") as HTMLInputElement).value = "nope";
    (q("#ppgo") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(q("#pperr")?.textContent).toContain("didn't work"));
    expect(q(".card")).toBeNull(); // still withheld
    // correct passphrase
    (q("#pp") as HTMLInputElement).value = "hunter2";
    (q("#ppgo") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(q(".card")).toBeTruthy());
    const badges = [...app().querySelectorAll(".badge")].map((b) => b.textContent);
    expect(badges.join(" ")).toContain("Verified");
    expect(badges.join(" ")).toContain("Encrypted");
  });
});

describe("receiver UI — failure + camera errors", () => {
  it("withholds the file loudly when the SHA-256 gate fails", async () => {
    await mountReceiver();
    // Corrupt the stored digest so decode succeeds but verify fails.
    const msg = await buildMessage(file("photo.bin", "x".repeat(300)));
    for (let i = 0; i < msg.length - 2; i++) {
      if (msg[i] === 0x58 && msg[i + 1] === 0x20) {
        msg[i + 2] = (msg[i + 2] ?? 0) ^ 0xff;
        break;
      }
    }
    const parts = systematicQrParts(msg, DEFAULT_MAX_FRAGMENT_LENGTH);
    q("#start")?.click();
    await vi.waitFor(() => expect(q("#progress")).toBeTruthy());
    feed(parts);
    await vi.waitFor(() => expect(q(".loud")).toBeTruthy());
    expect(q(".loud")?.textContent).toContain("nothing was saved");
    expect(q(".card")).toBeNull();
    expect(/accept/i.test(txt())).toBe(false);
  });

  it("shows the insecure-context screen when not on https", async () => {
    cam.secure = false;
    vi.resetModules();
    document.body.innerHTML = `<main id="app"></main>`;
    await import("../src/ui/receiver.js");
    await vi.waitFor(() => expect(q(".loud")).toBeTruthy());
    expect(txt()).toContain("https");
    cam.secure = true;
  });

  it("shows a camera-unavailable screen and can retry", async () => {
    await mountReceiver();
    cam.throwOnStart = new Error("no camera");
    q("#start")?.click();
    await vi.waitFor(() => expect(q("#retry")).toBeTruthy());
    expect(txt()).toContain("Camera unavailable");
  });
});

describe("receiver UI — resume offer", () => {
  it("offers Resume when a persisted partial exists; Start fresh clears it", async () => {
    res.partial = { parts: ["UR:BLINK-DROP/1-2/AA"], percent: 40, frames: 100, savedAt: 1 };
    await mountReceiver();
    expect(q("#resume")).toBeTruthy();
    expect(q("#resume")?.textContent).toContain("40%");
    (q("#fresh") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(q("#start")).toBeTruthy()); // back to Ready, partial cleared
  });
});

describe("receiver UI — multi-file zip actions", () => {
  it("Save .zip writes a bundle and Share .zip shares one archive", async () => {
    await mountReceiver();
    await scanToComplete([file("a.txt", "aaaa"), file("b.txt", "bbbb")]);
    (q("#save") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(q("#shareresult")?.textContent).toBe("Saved .zip."));

    const shared: { name: string; type: string }[] = [];
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    Object.defineProperty(navigator, "share", {
      value: (d: { files: File[] }) => {
        shared.push({ name: d.files[0]!.name, type: d.files[0]!.type });
        return Promise.resolve();
      },
      configurable: true,
    });
    (q("#sharezip") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(q("#shareresult")?.textContent).toBe("Shared."));
    expect(shared[0]?.name).toMatch(/\.zip$/);
    expect(shared[0]?.type).toBe("application/zip");
  });
});

describe("receiver UI — failure recovery", () => {
  async function corruptToFailed(): Promise<void> {
    const msg = await buildMessage(file("c.bin", "z".repeat(300)));
    for (let i = 0; i < msg.length - 2; i++) {
      if (msg[i] === 0x58 && msg[i + 1] === 0x20) {
        msg[i + 2] = (msg[i + 2] ?? 0) ^ 0xff;
        break;
      }
    }
    q("#start")?.click();
    await vi.waitFor(() => expect(q("#progress")).toBeTruthy());
    feed(systematicQrParts(msg, DEFAULT_MAX_FRAGMENT_LENGTH));
    await vi.waitFor(() => expect(q(".loud")).toBeTruthy());
  }

  it("Restart returns to Ready from the failure screen", async () => {
    await mountReceiver();
    await corruptToFailed();
    (q("#restart") as HTMLButtonElement).click();
    expect(q("#start")).toBeTruthy();
  });

  it("Keep scanning resumes collecting from the failure screen", async () => {
    await mountReceiver();
    await corruptToFailed();
    (q("#rescan") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(q("#progress")).toBeTruthy());
  });
});

describe("receiver UI — install prompt", () => {
  it("captures beforeinstallprompt and offers an Install button that fires the native prompt", async () => {
    await mountReceiver();
    let prompted = false;
    const ev = new Event("beforeinstallprompt") as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string }>;
    };
    ev.prompt = () => {
      prompted = true;
      return Promise.resolve();
    };
    ev.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(ev);
    await vi.waitFor(() => expect(q("#install-go")).toBeTruthy());
    (q("#install-go") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(prompted).toBe(true));
  });
});
