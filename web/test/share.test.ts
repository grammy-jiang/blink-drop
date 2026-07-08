// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadFile, shareOrDownload, shareOrDownloadMany } from "../src/receiver/share.js";

// share.ts is the receiver's OS-boundary export path (Web Share Level 2, files,
// with a download fallback). It only runs after the SHA-256 gate. These tests
// stub the Web Share API + URL/anchor so every branch — shared / cancelled /
// downloaded — is exercised in jsdom.

const bytes = new Uint8Array([1, 2, 3, 4]);

let created: string[] = []; // object URLs created
let revoked: string[] = []; // object URLs revoked
let clicks = 0; // anchor clicks (download fallback)

// jsdom's URL has no object-URL methods; define them so downloadFile works.
const urlMock = URL as unknown as {
  createObjectURL: (b: Blob) => string;
  revokeObjectURL: (u: string) => void;
};

beforeEach(() => {
  created = [];
  revoked = [];
  clicks = 0;
  urlMock.createObjectURL = () => {
    const u = `blob:mock/${created.length}`;
    created.push(u);
    return u;
  };
  urlMock.revokeObjectURL = (u: string) => {
    revoked.push(u);
  };
  // jsdom anchor .click() would attempt a navigation (noisy "not implemented");
  // count it instead.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
    clicks++;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const k of ["share", "canShare"]) {
    Object.defineProperty(navigator, k, { value: undefined, configurable: true, writable: true });
  }
});

function stubShare(opts: { canShare?: (d: unknown) => boolean; share?: (d: unknown) => Promise<void> }): {
  shared: unknown[];
} {
  const shared: unknown[] = [];
  Object.defineProperty(navigator, "canShare", {
    value: opts.canShare ?? (() => true),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(navigator, "share", {
    value:
      opts.share ??
      ((d: unknown) => {
        shared.push(d);
        return Promise.resolve();
      }),
    configurable: true,
    writable: true,
  });
  return { shared };
}

// A share() stub that records the File[] it was handed.
function capture(into: File[]): (d: unknown) => Promise<void> {
  return (d) => {
    into.push(...(d as { files: File[] }).files);
    return Promise.resolve();
  };
}

describe("shareOrDownload (single file)", () => {
  it("shares via the OS sheet when file-sharing is available", async () => {
    const captured: File[] = [];
    stubShare({ share: capture(captured) });
    const r = await shareOrDownload(bytes, "photo.png", "image/png");
    expect(r).toBe("shared");
    expect(captured).toHaveLength(1);
    expect(captured[0]?.name).toBe("photo.png");
    expect(captured[0]?.type).toBe("image/png");
    expect(clicks).toBe(0); // no download fallback
  });

  it("returns cancelled when the user dismisses the share sheet (AbortError)", async () => {
    stubShare({ share: () => Promise.reject(new DOMException("dismissed", "AbortError")) });
    const r = await shareOrDownload(bytes, "a.txt", "text/plain");
    expect(r).toBe("cancelled");
    expect(clicks).toBe(0);
  });

  it("falls back to a download when share fails for a non-abort reason", async () => {
    stubShare({ share: () => Promise.reject(new Error("boom")) });
    const r = await shareOrDownload(bytes, "a.txt", "text/plain");
    expect(r).toBe("downloaded");
    expect(clicks).toBe(1);
    expect(created).toHaveLength(1);
    expect(revoked).toEqual(created); // object URL is revoked after use
  });

  it("downloads when the Web Share API is unavailable", async () => {
    const r = await shareOrDownload(bytes, "a.bin", "application/octet-stream");
    expect(r).toBe("downloaded");
    expect(clicks).toBe(1);
  });

  it("sanitizes a hostile filename to a safe basename at the OS boundary", async () => {
    const captured: File[] = [];
    stubShare({ share: capture(captured) });
    await shareOrDownload(bytes, "../../etc/passwd", "text/plain");
    expect(captured[0]?.name).toBe("passwd");
  });

  it("defaults an empty media type to application/octet-stream", async () => {
    const captured: File[] = [];
    stubShare({ share: capture(captured) });
    await shareOrDownload(bytes, "x", "");
    expect(captured[0]?.type).toBe("application/octet-stream");
  });
});

describe("shareOrDownloadMany (multi file)", () => {
  const items = [
    { bytes, name: "one.txt", mediaType: "text/plain" },
    { bytes, name: "two.bin", mediaType: "application/octet-stream" },
  ];

  it("shares all files in one sheet when available", async () => {
    const captured: File[] = [];
    stubShare({ share: capture(captured) });
    const r = await shareOrDownloadMany(items);
    expect(r).toBe("shared");
    expect(captured.map((f) => f.name)).toEqual(["one.txt", "two.bin"]);
  });

  it("returns cancelled on AbortError", async () => {
    stubShare({ share: () => Promise.reject(new DOMException("x", "AbortError")) });
    expect(await shareOrDownloadMany(items)).toBe("cancelled");
  });

  it("downloads each file when share is unavailable", async () => {
    const r = await shareOrDownloadMany(items);
    expect(r).toBe("downloaded");
    expect(clicks).toBe(2); // one download per file
  });
});

describe("downloadFile", () => {
  it("creates a named anchor, clicks it, and revokes the object URL", () => {
    downloadFile(bytes, "report.zip", "application/zip");
    expect(created).toHaveLength(1);
    expect(clicks).toBe(1);
    expect(revoked).toEqual(created);
  });
});
