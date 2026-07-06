import { defineConfig } from "vitest/config";

// Core is isomorphic (WebCrypto + CompressionStream are node globals), so unit
// tests run in plain node — no jsdom needed. No vite plugins here on purpose.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
