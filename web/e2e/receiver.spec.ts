import { expect, test } from "@playwright/test";

// Receiver, real browser. Runs across chromium / firefox / webkit (see
// playwright.config.ts). The optical round-trips live in roundtrip.spec.ts.

test("boots to the Ready screen", async ({ page }) => {
  await page.goto("receiver.html");
  await expect(page.locator("#start")).toBeVisible();
  await expect(page.locator("#app")).toContainText("Point your phone at the animation");
});

test("Start scanning runs the real camera loop (getUserMedia → video → scanCanvas)", async ({ page, browserName }) => {
  // Playwright's WebKit has no fake camera device, so getUserMedia can't yield a
  // stream there — this path is exercised on chromium + firefox instead.
  test.skip(browserName === "webkit", "WebKit (Playwright) has no fake camera device");
  await page.goto("receiver.html");
  await page.locator("#start").click();
  // The fake device yields a live video with no QR, so the receiver stays in
  // Collecting — but camera.ts's getUserMedia + video + scan interval all execute.
  await expect(page.locator("#mount video")).toBeAttached({ timeout: 15_000 });
  await expect(page.locator("#progress")).toBeVisible();
});
