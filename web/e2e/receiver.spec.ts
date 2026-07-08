import { expect, test } from "@playwright/test";

// Receiver, real browser (chromium + a fake media device).

test("boots to the Ready screen", async ({ page }) => {
  await page.goto("receiver.html");
  await expect(page.locator("#start")).toBeVisible();
  await expect(page.locator("#app")).toContainText("Point your phone at the animation");
});

test("the built-in stream test proves render → scan → reconstruct → SHA-256 verify", async ({ page }) => {
  // ?streamtest mounts the M0 harness: sender canvas → captureStream → a real
  // jsQR scan loop → core reconstruct + verify — the whole optical pipeline on
  // real bytes in a real browser.
  await page.goto("receiver.html?streamtest");
  await page.waitForFunction(() => (window as unknown as { __streamtest?: unknown }).__streamtest !== undefined, null, {
    timeout: 30_000,
  });
  const result = await page.evaluate(
    () => (window as unknown as { __streamtest: { ok: boolean; verified: boolean } }).__streamtest,
  );
  expect(result.ok).toBe(true);
  expect(result.verified).toBe(true);
});

test("Start scanning runs the real camera loop (getUserMedia → video → scanCanvas)", async ({ page }) => {
  await page.goto("receiver.html");
  await page.locator("#start").click();
  // The fake device yields a live video with no QR, so the receiver stays in
  // Collecting — but camera.ts's getUserMedia + video + scan interval all execute.
  await expect(page.locator("#mount video")).toBeAttached({ timeout: 15_000 });
  await expect(page.locator("#progress")).toBeVisible();
});
