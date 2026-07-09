import { defineConfig, devices } from "@playwright/test";

// Real-browser E2E against the built site (vite preview), Tier 3 of docs/20.
// Chromium runs with a fake media device so the receiver's real camera path
// (getUserMedia → video → scanCanvas loop in camera.ts) executes without hardware.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["line"]] : [["list"]],
  use: {
    baseURL: "http://localhost:4173/blink-drop/",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
        },
      },
    },
    {
      // Firefox with a fake getUserMedia device (prefs, not CLI flags).
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        launchOptions: {
          firefoxUserPrefs: {
            "media.navigator.streams.fake": true,
            "media.navigator.permission.disabled": true,
          },
        },
      },
    },
    {
      // WebKit = Safari's engine — the receiver's real iOS target. Playwright
      // WebKit has no fake-camera device, so getUserMedia-based specs skip
      // themselves here (see e2e specs); the ?streamtest optical pipeline uses
      // canvas.captureStream (no camera) and DOES run, proving the whole
      // render→scan→reconstruct→verify path works in Safari's engine.
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  // `npm run e2e` builds first; preview serves web/dist at /blink-drop/.
  webServer: {
    command: "npm run preview",
    url: "http://localhost:4173/blink-drop/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
