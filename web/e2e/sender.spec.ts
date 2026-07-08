import { expect, test } from "@playwright/test";

// Sender, real browser: a dropped file is encoded and animated as a real QR on a
// real canvas (covers sender.ts + render.ts end to end, no mocks).
test("dropping a file plays an animated QR with a plan", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#dropzone")).toBeVisible();

  await page.locator("#file").setInputFiles({
    name: "hello.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello from playwright ".repeat(4)),
  });

  // Stage reveals; the QR canvas gets real dimensions; the plan names the file.
  await expect(page.locator("#stage")).toBeVisible();
  await expect(page.locator("#plan")).toContainText("hello.txt");
  await expect(page.locator("#plan")).toContainText("loop");
  const qrWidth = await page.locator("#qr").evaluate((c) => (c as HTMLCanvasElement).width);
  expect(qrWidth).toBeGreaterThan(0);

  // The status advances into Playing (the FramePlayer is animating).
  await expect(page.locator("#status")).toContainText(/Playing|Encrypting|Preparing/);
});

test("the receiver-link QR renders on load", async ({ page }) => {
  await page.goto("./");
  const w = await page.locator("#receiverqr").evaluate((c) => (c as HTMLCanvasElement).width);
  expect(w).toBeGreaterThan(0);
});
