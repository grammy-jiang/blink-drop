import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Main build → the GitHub Pages site: two pages (index.html = sender,
// receiver.html = the installable PWA receiver). Dev stays at "/"; the
// production build uses the project-site base "/blink-drop/".
// The single-file offline sender is a separate build (vite.config.sender.ts).
export default defineConfig(({ mode }) => ({
  base: mode === "production" ? "/blink-drop/" : "/",
  // bc-ur references `global`; map it to globalThis for the browser.
  define: { global: "globalThis" },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/apple-touch-icon.png"],
      manifest: {
        name: "Blink-Drop",
        short_name: "Blink-Drop",
        description: "Receive files via animated QR codes — scan, verify, share.",
        theme_color: "#111827",
        background_color: "#111827",
        display: "standalone",
        start_url: "receiver.html",
        scope: ".",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: { globPatterns: ["**/*.{js,css,html,png,svg,webmanifest}"] },
    }),
  ],
  build: {
    target: "es2022",
    rollupOptions: {
      input: { main: "index.html", receiver: "receiver.html" },
    },
  },
}));
