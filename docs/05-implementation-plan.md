# Blink-Drop — Implementation Plan (MVP-1: PWA Receiver)

| | |
|---|---|
| **Status** | Draft v0.1 |
| **Date** | 2026-07-07 |
| **Scope** | The remaining work to turn the M0 browser receiver into the shipped **MVP-1 PWA receiver** (installable, HTTPS, camera scan → verify → Web Share). Hand-rolled (the `implementation-plan` skill is not installed). |
| **Sources** | `blink-drop-architecture-design.md` v0.1 **as amended by** `blink-drop-architecture-update.md` (PWA pivot); `blink-drop-ux-design.md` (receiver stories/E2E seeds); `00-blueprint.md` v0.5 |
| **Reused unchanged** | `web/src/core` (protocol core), `web/src/qr` (render/scan), `shared/test-vectors`, the sender. The receiver already does camera → jsQR → core → verify → download (proven on real iPhone optics). |

---

## Delivery shape

MVP-1 is web work, **buildable and testable on this Linux machine** + browser automation. Deploy target: **GitHub Pages (HTTPS)** so the iPhone can reach it. The native iOS app is **deferred** (`docs/ios/*` + ADR-0006 are its future reference).

## Tasks (ordered)

Each task: goal · files · acceptance (→ blueprint S-criteria / ux E2E seed) · how verified.

### T1 — Split product receiver from dev harness
- **Goal:** `receiver.html` becomes the real product receiver; the M0 self-test / stream-test move behind a `?debug` flag (kept — they're our regression harness for the render/decode pipeline).
- **Files:** `web/receiver.html`, `web/src/ui/receiver.ts` (rewrite as the product app), `web/src/ui/debug.ts` (the moved self-test/stream-test).
- **Acceptance:** opening `receiver.html` shows the product UI; `receiver.html?debug` still runs the loopback + stream tests (they must still pass).
- **Verify:** browser automation — `?debug` self-test/stream-test still PASS; product UI renders.

### T2 — Secure-context + camera lifecycle
- **Goal:** on load, require a secure context (HTTPS or localhost); if insecure, show a clear "open this over https" message instead of a broken camera. Camera: permission priming → `getUserMedia({video:{facingMode:'environment'}})` → handle denied/no-camera.
- **Files:** `web/src/ui/receiver.ts`, `web/src/receiver/camera.ts`.
- **Acceptance:** insecure origin → guidance, no crash; permission denied → blocking explainer (ux US-R2); granted → scanning (**S5** zero-config start < 10 s).
- **Verify:** browser (localhost is a secure context) — camera path drivable; insecure-context branch unit-checkable.

### T3 — Receiver state UX (from ux-design §6.2 / §14)
- **Goal:** the real states — Ready (viewfinder + target frame + "point at the animation"), Locked (size + ETA; name pending), Collecting (denominator-true progress + live rate), `stalled` (escalating generic guidance), Reconstructing/Verifying, Complete, Failed (loud, file withheld).
- **Files:** `web/src/ui/receiver.ts`, `web/src/receiver/state.ts`, minimal CSS in `receiver.html`.
- **Acceptance:** honest progress (real fraction, never faked); verified only after SHA-256; loud fail withholds the file (**S2**); stall guidance appears (**S3** behaviour). States map to architecture §14.
- **Verify:** browser — drive via the synthetic `captureStream` camera; observe states + progress.

### T4 — Result card + Web Share + fallback
- **Goal:** on Complete, a result card (name, size, type, verified ✓) with **Share** (`navigator.share({files:[File]})`), **Save** (download), **Discard** (→ back to Ready). Feature-detect Web Share; download-link fallback when unsupported.
- **Files:** `web/src/receiver/share.ts`, `web/src/ui/receiver.ts`.
- **Acceptance:** file exposed only post-verify (**S2**); Web Share invoked where supported; fallback download otherwise (ux US-R6).
- **Verify:** browser — result card renders; `navigator.share` feature-detected (desktop Chrome may lack file share → fallback path exercised); real share sheet confirmed by user on iPhone.

### T5 — PWA: manifest + service worker
- **Goal:** installable + offline-after-first-load. `vite-plugin-pwa` (Workbox) generates the manifest + precache service worker; icons included.
- **Files:** `web/vite.config.ts` (PWA plugin), `web/public/manifest` assets + icons, registration.
- **Acceptance:** built receiver has a valid manifest + registered SW; second load works offline (**S7** receiver = post-install offline).
- **Verify:** build + serve `dist`; browser — manifest present, SW registers, offline reload serves from cache.

### T6 — GitHub Pages deploy
- **Goal:** build the site (sender `index.html` + receiver `receiver.html` + PWA) and publish to GitHub Pages (HTTPS). Keep the **single-file offline sender** as a separate build artifact.
- **Files:** `.github/workflows/pages.yml`, `web/vite.config.ts` (multi-page build), `web/vite.config.sender.ts` (single-file sender build).
- **Acceptance:** `https://grammy-jiang.github.io/blink-drop/receiver.html` serves the PWA over HTTPS; the sender is reachable too.
- **Verify:** the Pages workflow succeeds; user opens the URL on iPhone.

### T7 — Real-optics acceptance (user)
- **Goal:** confirm the end-to-end product on the real device.
- **Acceptance:** iPhone Safari → receiver URL → camera → scan the sender animation → **verified** → Web Share (**S1/S2/S5**).
- **Verify:** user runs it on their iPhone (the one step I can't do — no camera here).

## Build order & verification

1. T1–T4 (the app) — verify each in-browser via automation (localhost = secure context; synthetic `captureStream` camera drives the flow).
2. T5 (PWA) — verify manifest/SW/offline on a built `dist`.
3. T6 (deploy) — Pages workflow green.
4. T7 — user confirms on iPhone.
5. Regression: `npm test` (core 19), `?debug` self-test + stream-test, `biome ci`, `tsc` — all green; pre-commit + CI pass.

## Deferred (not MVP-1)

Native iOS app (needs a Mac); encryption/DEC-1 (**v0.3** — designed in [`07-implementation-plan-v0.3-encryption.md`](07-implementation-plan-v0.3-encryption.md)); resume; multi-file; Android. `architecture --mode materialize` to merge the update note into a canonical design — later.
