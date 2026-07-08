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
        // Gate the security-critical, fully unit-testable core hard, so a
        // regression there fails CI. The global threshold is raised to 95 in
        // Tier 2 once the UI orchestrators are covered (docs/20).
        "src/core/**/*.ts": { lines: 90, statements: 90, functions: 90, branches: 85 },
      },
    },
  },
});
