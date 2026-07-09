import { expect, test } from "@playwright/test";

// Pixel-level visual regression for the two stable screens (sender Idle, receiver
// Ready) in light + dark. Chromium only — pixel baselines are per-engine, and one
// is enough to catch layout/spacing shifts the computed-style contract (visual.spec)
// can't. animations disabled + the install banner masked keep them deterministic;
// a generous maxDiffPixelRatio (set in playwright.config) absorbs cross-distro font
// anti-aliasing while still catching real changes (a re-coloured button or a moved
// element is a large pixel delta). Update baselines intentionally with
// `npm run e2e -- pixel --update-snapshots`.

for (const scheme of ["light", "dark"] as const) {
  test.describe(`pixel — ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test("sender Idle", async ({ page, browserName }) => {
      test.skip(browserName !== "chromium", "pixel baselines are chromium-only");
      await page.goto("./");
      await expect(page.locator(".content")).toHaveScreenshot(`sender-idle-${scheme}.png`);
    });

    test("receiver Ready", async ({ page, browserName }) => {
      test.skip(browserName !== "chromium", "pixel baselines are chromium-only");
      await page.goto("receiver.html");
      await expect(page.locator("#start")).toBeVisible();
      await expect(page.locator(".screen")).toHaveScreenshot(`receiver-ready-${scheme}.png`, {
        // The install banner only appears when the browser fires beforeinstallprompt
        // (non-deterministic in headless), so mask it out of the comparison.
        mask: [page.locator(".install")],
      });
    });
  });
}
