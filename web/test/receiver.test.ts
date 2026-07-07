// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CameraError, isSecureContextOk } from "../src/receiver/camera.js";
import { shareOrDownload } from "../src/receiver/share.js";

type MutableNavigator = Navigator & {
  canShare?: (data?: ShareData) => boolean;
  share?: (data?: ShareData) => Promise<void>;
};

function stubDownloadAnchor(): { click: ReturnType<typeof vi.fn> } {
  const click = vi.fn();
  const real = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const el = real(tag);
    if (tag === "a") (el as HTMLAnchorElement).click = click as unknown as HTMLAnchorElement["click"];
    return el;
  });
  return { click };
}

describe("share.ts — shareOrDownload", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    const nav = navigator as unknown as Record<string, unknown>;
    delete nav.canShare;
    delete nav.share;
    vi.restoreAllMocks();
  });

  it("uses Web Share when the file is shareable", async () => {
    const nav = navigator as MutableNavigator;
    nav.canShare = vi.fn(() => true);
    nav.share = vi.fn(async () => {});
    const result = await shareOrDownload(new Uint8Array([1, 2, 3]), "a.txt", "text/plain");
    expect(result).toBe("shared");
    expect(nav.share).toHaveBeenCalledOnce();
  });

  it("returns 'cancelled' when the user dismisses the share sheet", async () => {
    const nav = navigator as MutableNavigator;
    nav.canShare = vi.fn(() => true);
    nav.share = vi.fn(async () => {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    });
    const result = await shareOrDownload(new Uint8Array([1]), "a.txt", "text/plain");
    expect(result).toBe("cancelled");
  });

  it("falls back to a download when Web Share is unavailable", async () => {
    const { click } = stubDownloadAnchor();
    const result = await shareOrDownload(new Uint8Array([1]), "b.bin", "application/octet-stream");
    expect(result).toBe("downloaded");
    expect(click).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
  });

  it("falls back to a download when canShare rejects the file", async () => {
    const nav = navigator as MutableNavigator;
    nav.canShare = vi.fn(() => false);
    const { click } = stubDownloadAnchor();
    const result = await shareOrDownload(new Uint8Array([9]), "c.bin", "");
    expect(result).toBe("downloaded");
    expect(click).toHaveBeenCalledOnce();
  });
});

describe("camera.ts — guards", () => {
  it("isSecureContextOk reflects window.isSecureContext", () => {
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    expect(isSecureContextOk()).toBe(true);
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
    expect(isSecureContextOk()).toBe(false);
  });

  it("CameraError is an Error carrying its typed name", () => {
    const e = new CameraError("PermissionDenied", "denied");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("PermissionDenied");
    expect(e.message).toBe("denied");
  });
});
