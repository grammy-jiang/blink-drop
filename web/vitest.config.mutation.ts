import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

// Vitest config for Stryker mutation runs (`npm run mutation`). Same environment
// and timeouts as the base suite, but:
//   1. excludes vectors.test.ts — it reads conformance fixtures from the
//      repo-root shared/test-vectors/ (outside web/), which Stryker's web/-rooted
//      sandbox can't copy, so it ENOENTs in the sandbox;
//   2. disables coverage — Stryker does its own instrumentation.
// The core logic under mutation stays covered by the pure unit tests
// (core / cbor / cbor-depth / crypto / edge / multifile / fuzz).
export default mergeConfig(
  base,
  defineConfig({
    test: {
      exclude: ["**/node_modules/**", "**/dist/**", "**/.stryker-tmp/**", "e2e/**", "test/vectors.test.ts"],
      coverage: { enabled: false },
    },
  }),
);
