# Blink-Drop — Test + CI Enhancement Plan

| | |
|---|---|
| **Status** | Draft v0.1 — raise measured coverage toward >95% and deepen CI (2026-07-08) |
| **Scope** | Add coverage tooling + a CI threshold gate; unit-test the browser glue and the two UI orchestrators; add a real-browser E2E suite; add Lighthouse + a Node matrix. **No product/wire change** — tests + CI only. |

## 1. Baseline (measured 2026-07-08, vitest 3.2.7, v8 coverage, all `src/**`)

Overall **48.2% lines** — but split cleanly:

- **Core (isomorphic protocol/crypto) already ≥93%:** crypto/digest/gzip/types/index/bundle/filename/size **100**, cbor **98.8**, envelope **93.0**, ur **93.0**.
- **Browser/DOM code ~0% in node unit tests** (drags the total): `ui/receiver.ts` 0 (313 lines), `ui/sender.ts` 0 (129), `ui/debug.ts` 0 (159 — the dev-only harness), `player/loop` 0, `qr/render` 0, `qr/scan` 30, `receiver/camera` 22, `receiver/resume` 20, `receiver/share` 61.

These need a browser (DOM, canvas, camera, IndexedDB), so they were validated by manual browser E2E, which does not count toward vitest coverage. >95% overall is reachable, but only by adding browser-capable tests + excluding the dev-only harness/entry from the metric.

## 2. Approach by tier

### Tier 1 — coverage tooling + glue tests + CI gate
- Add `@vitest/coverage-v8`; `coverage` config in `vitest.config.ts`: `provider: v8`, `all: true`, `include: src/**/*.ts`, `exclude` the dev-only harness (`ui/debug.ts`), the import shim (`polyfill.ts`), and `*.d.ts`. Add a `test:coverage` script.
- **Threshold gate, phased:** start with a per-glob threshold on `src/core/**` (lines ≥ 90) so a core regression fails CI immediately; raise the global threshold to 95 in Tier 2 once the UI is covered.
- **Glue unit tests** (node/jsdom, no new heavy deps):
  - `share.test.ts` (jsdom) — stub `navigator.canShare`/`share`; cover `shareOrDownload` / `shareOrDownloadMany` / `downloadFile` (shared / cancelled / downloaded). 61 → ~100.
  - `loop.test.ts` — `FramePlayer` with a mocked renderer + stubbed rAF: start / fps-gating / wrap+cycles / stop / live scale / idempotent start.
  - (`render` / `scan` / `camera` / `resume` need a real canvas + fake-indexeddb → deferred to Tier 2 with those deps, rather than throwaway stubbed tests here.)

### Tier 2 — UI unit tests (the big coverage jump)
- Add dev deps `canvas` (real 2d for render/scan round-trips) + `fake-indexeddb` (resume).
- **`sender.ts` jsdom test** — mount `index.html`'s DOM, drive file → `processFiles` → real QR render (node-canvas), assert stage/plan; passphrase + kdf default (argon2id) + strength; Adjust sliders.
- **`receiver.ts` jsdom test** — render every screen (Ready / Resume-offer / Collecting / Passphrase / Complete / Failed / Insecure / Denied); simulate the `getUserMedia`-override synthetic-frame flow (as in the manual E2E) to drive Ready→Collecting→Verify→Complete for plaintext, encrypted (+ wrong-pass), multi-file; the share/save/discard handlers; the install-prompt (beforeinstallprompt → Install button).
- `render`/`scan` round-trips via `@napi-rs/canvas` (prebuilt, no cairo); `camera.ts` getUserMedia error mapping.
- **Outcome:** overall lines **48% → 86.6%**, 140 tests; core + loop + render + scan + share + bundle + filename + size all 100%. Global gate set to **85** lines / 78 branches (headroom below current).
- **The last stretch to >95% is Tier 3.** `resume.ts` (IndexedDB — a non-extractable `CryptoKey` can't be structured-cloned in node) and `camera.ts`'s live scan loop (video playback) are genuinely browser-only. Playwright (Tier 3) exercises them in a real browser; with V8 coverage merged, the combined number clears 95%.

### Tier 3 — real-browser E2E (Playwright) — SHIPPED
- `@playwright/test` + `playwright.config.ts` (chromium with `--use-fake-device-for-media-stream`, `webServer: vite preview`), `web/e2e/`, and an `e2e` npm script (`build` + `playwright test`).
- **`e2e/sender.spec.ts`** — a dropped file plays a real animated QR on a real canvas (sender.ts + render.ts end-to-end); the receiver-link QR renders.
- **`e2e/receiver.spec.ts`** — boots to Ready; the `?streamtest` harness proves **render → scan → reconstruct → SHA-256 verify** on real bytes in real chromium (`ok:true, verified:true`); **Start scanning runs the real camera loop** (`getUserMedia` → `<video>` → `scanCanvas`) — the `camera.ts` path unit tests can't reach.
- New CI job **`e2e`** (pinned SHAs, `playwright install --with-deps chromium`, uploads traces on failure).
- 5 E2E specs, all green locally. The live camera loop + optical pipeline are now covered by an automated real-browser run (not just manual). Merging Playwright V8 coverage into the vitest number is left as an optional future step; the coverage *gate* stays on the unit suite.

### Tier 4 — extras
- **Lighthouse CI** — a11y / best-practices / SEO / PWA budget gate on the built site (pins the manual v0.7.2 audit).
- **Node matrix** — run the `web` job on Node 20 + 22.

## 3. Tasks
- **T1 (Tier 1):** coverage dep + config + `test:coverage`; `share`/`loop`/`scan`/`render` tests; CI coverage step + core threshold gate; this doc.
- **T2 (Tier 2):** `canvas` + `fake-indexeddb`; `sender`/`receiver` jsdom suites; resume/scan/render round-trips; raise global threshold to 95.
- **T3 (Tier 3):** Playwright suite + `e2e` CI job.
- **T4 (Tier 4):** Lighthouse-CI job + Node 20/22 matrix.

## 4. Non-goals / invariants
- No product/wire/UI change — tests + CI only. The 90 existing tests keep passing.
- Coverage `exclude` is limited to the dev-only harness (`ui/debug.ts`), the import shim (`polyfill.ts`), and type-only files — never product logic (that gets *tested*, not excluded).
- Each tier ships as its own PR (branch → PR → CI → merge), smallest-first.
