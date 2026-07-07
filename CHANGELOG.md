# Changelog

All notable changes to Blink-Drop are recorded here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions follow SemVer.

## 0.2.0 — 2026-07-07

Hardening and polish on top of the first release. No protocol or wire changes —
v0.1 senders and receivers remain compatible.

### Added

- **Content-Security-Policy at build** — every built page carries a strict CSP
  meta tag: the receiver forbids off-origin egress (`connect-src 'self'`) and
  the offline sender forbids network entirely (`connect-src 'none'`). A Vite
  plugin injects it so it can't drift from the HTML. (H1)
- **Receiver QR on the sender** — the sender page shows a static QR of the
  receiver URL, so the phone opens the PWA by scanning instead of typing. (P1)
- **Maskable PWA icon** — a 512px maskable icon so adaptive/rounded launcher
  masks don't clip the glyph. (P4)
- **"Add to Home Screen" hint** — a dismissible tip on the receiver's Ready
  screen, shown only in a browser tab (hidden once installed). (P3)
- **Favicon** — an inline SVG favicon on both pages (works in the single-file
  sender build too, with no external asset). (P2)

### Changed

- GitHub Actions pinned to current major versions (Node 24 toolchain). (H3)

### Tested

- Added jsdom coverage for the receiver's share/download and camera-guard paths
  — 25 tests total, up from 19. (H2)

## 0.1.0 — 2026-07-07

First release. Offline small-file transfer via animated QR codes — a web sender
and an installable PWA receiver, no network/cable/cloud/pairing between them.

### Added

- **Web sender** — a static, client-side page that turns a file into an animated
  QR stream. Also builds as a single self-contained offline HTML file
  (`npm run build:sender`) for air-gapped machines.
- **PWA receiver** — an installable web app: camera scan (`getUserMedia` + jsQR),
  reconstruct, **SHA-256 verify**, then share via the Web Share API (real iOS
  share sheet) with a download fallback. Live at
  <https://grammy.jiang.is/blink-drop/receiver.html>.
- **Protocol** — adopt Blockchain Commons UR/MUR fountain coding + gzip +
  SHA-256; deterministic CBOR envelope; decompression-bomb guard. Documented in
  `docs/01-protocol.md`.
- **Protocol core** (`web/src/core`) — pure, isomorphic (browser + node), with
  `shared/test-vectors/` as the cross-language contract.
- **Design docs** (`docs/`) — blueprint, protocol, architecture (+ the PWA-pivot
  update), UX design, and implementation plan.
- **Tooling & CI** — Biome (lint + format), TypeScript, Vitest, pre-commit hooks,
  GitHub Actions CI, and a GitHub Pages deploy workflow.

### Proven

- Protocol round-trips end to end, including on **real iPhone optics** (a phone
  photo of the QR decoded bit-perfect and verified).
- The PWA receiver's full flow (scan → verify → result) verified in-browser.

### Notes / not yet

- **Native iOS app is deferred** — it needs a Mac (macOS-only toolchain); the PWA
  is the v0.1 receiver. `docs/ios/*` remain the future-native reference.
- **No payload confidentiality in v0.1** (the QR is visible by design). Passphrase
  encryption is the top item for a future release.

[0.2.0]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.2.0
[0.1.0]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.1.0
