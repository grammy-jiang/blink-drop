import { defineConfig } from "vitest/config";

// Core is isomorphic (WebCrypto + CompressionStream are node globals), so unit
// tests run in plain node — no jsdom needed. DOM-touching tests opt into jsdom
// per-file with `// @vitest-environment jsdom`. No vite plugins here on purpose.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      all: true, // count untested files too, so coverage is honest
      include: ["src/**/*.ts"],
      // Excluded from the metric: the dev-only regression harness, the import
      // shim, and type-only files. Product logic is never excluded — it is tested.
      exclude: ["src/ui/debug.ts", "src/polyfill.ts", "src/**/*.d.ts"],
      reporter: ["text-summary", "json-summary"],
      thresholds: {
        // Global floor (headroom below the current 86.6% lines / 82.7% branches),
        // so a coverage regression fails CI. The last stretch to >95% is Tier 3:
        // resume.ts (IndexedDB) + camera.ts's scan loop are browser-only and are
        // covered by the Playwright E2E suite, not node unit tests (docs/20).
        lines: 85,
        statements: 85,
        functions: 88,
        branches: 78,
        // The security-critical core is fully unit-testable — gate it harder.
        "src/core/**/*.ts": { lines: 90, statements: 90, functions: 90, branches: 85 },
      },
    },
  },
});
