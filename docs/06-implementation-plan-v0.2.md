# Blink-Drop — Implementation Plan (v0.2: Harden + Polish)

| | |
|---|---|
| **Status** | Draft v0.1 |
| **Date** | 2026-07-07 |
| **Target release** | **v0.2.0** |
| **Scope** | Close the gap between the shipped code and the design's claims (security), put a test net under the receiver, and add small user-facing polish. **Encryption is out of scope** — it changes the protocol and gets its own cycle (protocol/arch update → `07-implementation-plan-v0.3-encryption.md` → v0.3). |
| **Sources** | Post-0.1 backlog (this session); architecture §17 (CSP/egress gates SG-3/SG-4′); `blink-drop-ux-design.md` (receiver stories, US-R2 permission priming); `blink-drop-architecture-update.md` (PWA truth). |
| **Baseline** | v0.1.0 — sender + PWA receiver live at `grammy.jiang.is/blink-drop/`. Receiver = `web/src/receiver/*` + `src/ui/receiver.ts`; share = `src/receiver/share.ts`; core reused unchanged. |

Each task: **Goal · Files · Approach · Acceptance · Verify.** All verification is doable on Linux + browser automation (localhost is a secure context; a synthetic `captureStream` drives the camera path).

---

## Harden

### H1 — CSP / no-egress enforcement (the honesty fix)
- **Goal:** make "the file never leaves the device" *enforced*, not just asserted (architecture SG-3 sender, SG-4′ receiver). Today neither page ships a CSP.
- **Files:** `web/index.html`, `web/receiver.html` (CSP `<meta>`); confirm it survives both builds (`vite.config.ts` Pages, `vite.config.sender.ts` single-file).
- **Approach:**
  - **Sender** (`connect-src 'none'`): no network at all. Single-file build inlines JS/CSS → needs `script-src`/`style-src 'unsafe-inline'` (accept — the *load-bearing* control is `connect-src 'none'`). Meta: `default-src 'self'; connect-src 'none'; img-src 'self' data: blob:; base-uri 'none'`.
  - **Receiver** (`connect-src 'self'`): the service worker must fetch same-origin assets, so `'none'` would break offline — use `'self'`. Camera is a permission, not `connect-src`, so it's unaffected; the video stream is a `blob:`/stream, cover with `media-src 'self' blob:`. Meta: `default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self'`.
  - **Risk:** `vite-plugin-pwa` injects an inline `registerSW` script; a strict `script-src 'self'` may block it. Resolve during impl via the plugin's `injectRegister: 'script'` (external file) or a nonce/hash. Verify the SW still registers.
- **Acceptance:** built `dist/receiver.html` + `dist/index.html` (and `dist-sender/index.html`) carry the CSP; the receiver still gets camera + SW + offline; the sender still plays; no request goes to any external origin. Ties SG-3, SG-4′.
- **Verify:** grep built HTML for the CSP meta; drive the receiver in-browser (camera path + SW registration still work); assert no `fetch`/XHR to non-self in a network-log check; run the existing `?streamtest`/product-flow to confirm no regression.

### H2 — Receiver + share unit tests (the test net)
- **Goal:** cover the product receiver logic (only `core` is tested today); guard `share.ts` and the secure-context/state boundaries before more is built on them.
- **Files:** new `web/test/receiver.test.ts` (jsdom env); add `jsdom` devDep; possibly small refactors in `src/receiver/share.ts` / `src/ui/receiver.ts` to expose pure bits; `vitest.config.ts` (jsdom for that file, or `// @vitest-environment jsdom` pragma).
- **Approach:**
  - `share.ts`: unit-test both branches — (a) `navigator.canShare({files})` true → `navigator.share` called, returns `"shared"`; abort → `"cancelled"`; (b) unsupported → download fallback (`<a download>.click()`), returns `"downloaded"`. Mock `navigator.share`/`canShare`, `URL.createObjectURL`.
  - `camera.ts` `isSecureContextOk()` + `CameraError` mapping: unit-testable with `window.isSecureContext` stubbed.
  - State machine: light jsdom test that `renderComplete` shows the verified card + wires Share/Save/Discard; the live camera loop stays integration-only (browser `?streamtest`, already green).
- **Acceptance:** new tests pass in CI (node/jsdom); `share.ts` both paths covered.
- **Verify:** `npm test` (now includes the receiver suite); CI green.

### H3 — GitHub Actions runtime bump
- **Goal:** clear the "Node 20 is deprecated" CI annotation.
- **Files:** `.github/workflows/ci.yml`, `.github/workflows/pages.yml`.
- **Approach:** bump `actions/checkout`, `actions/setup-node`, `actions/setup-python`, `actions/upload-pages-artifact`, `actions/deploy-pages`, and `pre-commit/action` to the latest majors that run on Node 24. Verify each still exists at the pinned major.
- **Acceptance:** CI + Pages run with no Node-20 deprecation annotation.
- **Verify:** push → check the run's annotations are gone; jobs still green.

---

## Polish

### P1 — Receiver-URL QR on the sender (one-scan jump)
- **Goal:** the sender shows a small static QR of the **receiver URL** so the phone's *native* camera opens the receiver in one tap — no typing a URL on the phone.
- **Files:** `web/src/qr/render.ts` (add a general text→QR helper — the existing `renderUrToCanvas` forces Alphanumeric mode, which a lowercase URL can't use; add `renderTextToCanvas` using qrcode-generator auto/Byte mode), `web/src/ui/sender.ts`, `web/index.html` (a corner slot).
- **Approach:** derive the URL at runtime — `new URL('receiver.html', location.href).href` (works on Pages `/blink-drop/` and locally). Render it small (~140px) with a "Scan to open on your phone" caption.
- **Acceptance:** the sender shows a scannable QR that opens the receiver URL; a native iOS camera opens it.
- **Verify:** browser — render it, jsQR-decode → equals the receiver URL.

### P2 — Favicon
- **Goal:** kill the favicon 404; show the app icon in the tab.
- **Files:** `web/scripts/gen-icons.ts` (emit `favicon.svg` or a 32px `favicon.png`), `web/index.html` + `web/receiver.html` (`<link rel="icon">`), `web/public/`.
- **Acceptance:** no `/favicon.ico` 404 in console; tab shows the icon.
- **Verify:** load both pages; check network/console.

### P3 — iOS "Add to Home Screen" hint
- **Goal:** make install discoverable on iOS (Safari fires no `beforeinstallprompt`).
- **Files:** `web/src/ui/receiver.ts` (a dismissible hint), `web/receiver.html` (styles).
- **Approach:** if iOS Safari **and** not already standalone (`!(navigator as any).standalone` + iOS UA), show a one-line dismissible banner: "Add to Home Screen to install (Share → Add to Home Screen)". Persist dismissal in `localStorage`.
- **Acceptance:** hint appears on iOS Safari, not when installed/other browsers; dismiss sticks.
- **Verify:** browser with a spoofed iOS UA / `standalone` stub; toggle both states.

### P4 — Proper maskable icon
- **Goal:** the maskable icon currently reuses `icon-512` (finder patterns near the edge → cropped under a circular mask). Give it safe-zone padding.
- **Files:** `web/scripts/gen-icons.ts` (emit `icon-maskable-512.png` — same glyph scaled to the central ~80% on the full-bleed background), `web/vite.config.ts` (point the `purpose: "maskable"` icon at it).
- **Acceptance:** maskable icon keeps the glyph inside the safe zone.
- **Verify:** inspect the generated PNG; (optional) a maskable-preview check.

---

## Build order & release

1. **H1** first (security honesty), then **H2** (lock behavior before piling on polish).
2. **P1–P4** (independent, any order), **H3** anytime.
3. Regression each step: `npm test` (core + new receiver suite), `?debug` self-test + `?streamtest`, `biome ci`, `tsc`; pre-commit + CI green; a build (`npm run build` + `npm run build:sender`) to confirm CSP/PWA survive bundling.
4. **Release v0.2.0:** branch `feat/v0.2-harden-polish` → implement → PR (CI green) → squash-merge → bump `web/package.json` 0.1.0 → 0.2.0 + CHANGELOG → tag `v0.2.0` + GitHub release. Redeploys to Pages automatically.

## Out of scope (later)
- **Encryption** (v0.3): protocol header field + AES-GCM in `core/` + new test vectors + passphrase UX — its own design cycle first.
- Fuller ux-design receiver stories (US-R richer progress), Playwright E2E in CI, `architecture --mode materialize`, resume/multi-file/Android, the native iOS app (needs a Mac).
