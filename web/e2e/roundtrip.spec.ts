import { expect, type Page, test } from "@playwright/test";

// Optical round-trip E2E. Two harnesses (see debug.ts):
//   - ?loopback:  camera-free (core → render → jsQR → reconstruct → verify). Runs
//     in EVERY engine incl. WebKit (Safari), proving the decode + crypto stack.
//   - ?streamtest: the real MediaStream path (canvas.captureStream → <video> →
//     scan). Chromium + Firefox only — Playwright's WebKit yields no captureStream
//     frames; the live camera transport is validated on a real device (T5).

interface Summary {
  ok: boolean;
  reconstructed: boolean;
  verified: boolean;
  rejected: boolean;
  encrypted: boolean;
  tampered: boolean;
}

async function readHarness(page: Page, query: string, global: "__loopback" | "__streamtest"): Promise<Summary> {
  await page.goto(`receiver.html?${query}`);
  await page.waitForFunction((g) => (window as unknown as Record<string, unknown>)[g] !== undefined, global, {
    timeout: 40_000,
  });
  return page.evaluate((g) => (window as unknown as Record<string, Summary>)[g], global);
}

test.describe("camera-free loopback (all engines, incl. WebKit)", () => {
  test("plain round-trip verifies (render → scan → reconstruct → SHA-256)", async ({ page }) => {
    test.setTimeout(60_000);
    const r = await readHarness(page, "loopback", "__loopback");
    expect(r.reconstructed).toBe(true);
    expect(r.verified).toBe(true);
    expect(r.ok).toBe(true);
  });

  test("encrypted round-trip verifies (AES-GCM + Argon2id)", async ({ page }) => {
    test.setTimeout(60_000);
    const r = await readHarness(page, "loopback&pass=correct-horse-battery-staple", "__loopback");
    expect(r.encrypted).toBe(true);
    expect(r.verified).toBe(true);
  });

  test("tampered transfer never verifies — the SHA-256 gate rejects corrupt bytes", async ({ page }) => {
    test.setTimeout(60_000);
    const r = await readHarness(page, "loopback&tamper=1", "__loopback");
    expect(r.reconstructed).toBe(true); // reconstruction succeeded…
    expect(r.verified).toBe(false); // …but the integrity gate refused it
    expect(r.ok).toBe(true); // = the security invariant held
  });
});

test("real MediaStream path verifies (captureStream → video → scan)", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "Playwright WebKit's canvas.captureStream yields no frames");
  test.setTimeout(60_000);
  const r = await readHarness(page, "streamtest", "__streamtest");
  expect(r.reconstructed).toBe(true);
  expect(r.verified).toBe(true);
});
