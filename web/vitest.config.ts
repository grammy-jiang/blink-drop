import { defineConfig } from "vitest/config";

// Core is isomorphic (WebCrypto + CompressionStream are node globals), so unit
// tests run in plain node — no jsdom needed. DOM-touching tests opt into jsdom
// per-file with `// @vitest-environment jsdom`. No vite plugins here on purpose.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Headroom for slow CI runners: some tests run real KDFs (PBKDF2 600k /
    // Argon2id) twice (encode + decode), which can exceed the 5s default.
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      // vitest 4 counts all `include`d files (untested too) by default — no `all` flag.
      include: ["src/**/*.ts"],
      // Excluded from the metric: the dev-only regression harness, the import
      // shim, and type-only files. Product logic is never excluded — it is tested.
      exclude: ["src/ui/debug.ts", "src/polyfill.ts", "src/**/*.d.ts"],
      reporter: ["text-summary", "json-summary"],
      thresholds: {
        // Global floor (~1pt under the current 86 lines / 83 stmts / 78 branches /
        // 78 funcs), so a coverage regression fails CI. Rebaselined upward after
        // the cbor/envelope/ur mutation-kill tests raised branch coverage. The
        // last stretch to >95% is Tier 3: resume.ts (IndexedDB) + camera.ts's scan
        // loop are browser-only and are covered by the Playwright E2E suite, not
        // node unit tests (docs/20).
        lines: 85,
        statements: 82,
        functions: 77,
        branches: 77,
        // The security-critical core is fully unit-testable — gate it harder.
        "src/core/**/*.ts": { lines: 90, statements: 90, functions: 90, branches: 82 },
      },
    },
  },
});
