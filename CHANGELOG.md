# Changelog

All notable changes to Blink-Drop are recorded here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions follow SemVer.

## 0.3.0 — 2026-07-07

Opt-in passphrase encryption. Plaintext transfers are byte-for-byte unchanged —
v0.2 and v0.3 interoperate for unencrypted files.

### Added

- **Passphrase encryption (opt-in).** Set a passphrase on the sender and the
  transfer is encrypted with **AES-256-GCM** under a **PBKDF2-HMAC-SHA-256** key —
  both WebCrypto-native, so the offline single-file sender still needs no
  wasm/library blob. The file **and its metadata** (name, type, size, hash) are
  sealed; the QR animation reveals only that a transfer of some size happened.
- **Receiver passphrase flow.** The receiver detects an encrypted stream and
  prompts for the passphrase. A wrong passphrase is a distinct, loud,
  file-withheld state (never "accept anyway") — separate from a corruption
  failure. Success shows a 🔒 Encrypted badge with an honest note on what stays
  visible.
- **Encrypted test vector** — a byte-exact cross-language framing vector
  (`shared/test-vectors/framing/vec-04-encrypted`).

### Security

- compress-then-encrypt; the outer KDF/cipher params are bound as AES-GCM AAD (no
  parameter downgrade); two integrity checks on open (GCM tag + the SHA-256
  file-acceptance gate). The DEC-2 security review was re-run for the new wire
  format (architecture update-2 §U2.5).
- Honest limits (the no-overclaim posture survives the reversal): a transfer's
  size and that it happened still leak; passphrase strength is the ceiling;
  symmetric, so no sender identity.

### Notes

- No protocol break: the plaintext envelope is unchanged; header key `0`
  discriminates encrypted from plaintext.
- Reverses DEC-1 ("no v1 confidentiality") — now opt-in. Design:
  `docs/07-implementation-plan-v0.3-encryption.md`.

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

[0.3.0]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.3.0
[0.2.0]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.2.0
[0.1.0]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.1.0
