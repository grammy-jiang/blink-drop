import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { cspPlugin } from "./vite-csp";

// Single-file offline sender (OQ-9, R-OFFLINE): everything inlined into one
// portable blink-drop.html that runs from a saved file on a disconnected
// machine. Built separately from the GitHub Pages site (vite.config.ts).
//   npm run build:sender  ->  dist-sender/index.html
export default defineConfig({
  base: "./",
  define: { global: "globalThis" },
  // inlineScripts: this build inlines all JS (viteSingleFile), so its sender CSP
  // keeps script-src 'unsafe-inline' — unlike the hosted Pages sender.
  plugins: [viteSingleFile(), cspPlugin({ inlineScripts: true })],
  build: {
    outDir: "dist-sender",
    target: "es2022",
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: { input: "index.html" },
  },
});
