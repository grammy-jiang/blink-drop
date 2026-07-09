import { expect, type Page, test } from "@playwright/test";

// Deterministic "visual contract": assert the design TOKENS actually render —
// serif brand, terracotta accent, warm background, and (critically) the WCAG-AA
// contrast of the primary button — in BOTH light and dark. No pixel baselines,
// so no cross-platform flakiness; this catches the colour / font / contrast
// class of regression that bit v0.11 (the raw #c6613f accent failed 4.5:1).

function rgb(s: string): [number, number, number] {
  const m = s.match(/(\d+),\s*(\d+),\s*(\d+)/);
  if (!m) throw new Error(`not an rgb() colour: ${s}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number): number => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: string, b: string): number {
  const la = luminance(rgb(a)) + 0.05;
  const lb = luminance(rgb(b)) + 0.05;
  return Math.max(la, lb) / Math.min(la, lb);
}
const css = (page: Page, sel: string, prop: string): Promise<string> =>
  page
    .locator(sel)
    .first()
    .evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

// Expected token values per scheme (from index.html / receiver.html :root).
const PAPER = { light: [250, 249, 245], dark: [20, 20, 19] } as const;
const ACCENT = { light: [176, 81, 46], dark: [217, 119, 87] } as const; // #b0512e / #d97757

for (const scheme of ["light", "dark"] as const) {
  test.describe(`design tokens — ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test("sender renders the warm bg, serif brand, and terracotta accent", async ({ page }) => {
      await page.goto("./");
      expect(rgb(await css(page, "body", "background-color"))).toEqual(PAPER[scheme]);
      expect((await css(page, ".brand", "font-family")).toLowerCase()).toContain("georgia");
      expect(rgb(await css(page, "summary", "color"))).toEqual(ACCENT[scheme]);
    });

    test("receiver's primary button is terracotta with an AA-contrast label", async ({ page }) => {
      await page.goto("receiver.html");
      const bg = await css(page, "button.primary", "background-color");
      const fg = await css(page, "button.primary", "color");
      expect(rgb(bg)).toEqual(ACCENT[scheme]);
      // The regression that bit v0.11: the label must clear WCAG AA (4.5:1).
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
      expect(rgb(await css(page, "body", "background-color"))).toEqual(PAPER[scheme]);
    });
  });
}
