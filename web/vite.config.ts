import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Single-file offline build (OQ-9): everything inlined into one blink-drop.html
// that runs from a saved file on a disconnected machine (R-OFFLINE).
// Test config lives in vitest.config.ts (kept separate to avoid the dual-vite
// type clash between vite and vitest's bundled vite).
export default defineConfig({
  plugins: [viteSingleFile()],
  // bc-ur references `global`; map it to globalThis for the browser. (Buffer is
  // supplied by src/polyfill.ts, imported first in each entry.)
  define: {
    global: "globalThis",
  },
  build: {
    target: "es2022",
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
  },
});
