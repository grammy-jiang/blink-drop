# Changelog

All notable changes to Blink-Drop are recorded here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions follow SemVer.

## 0.11.1 — 2026-07-09

Warm the installed-app icons to finish the v0.11.0 restyle.

### Changed

- Regenerated the home-screen / PWA icons (`icon-192`, `icon-512`,
  `icon-maskable-512`, `apple-touch-icon`) from the favicon geometry with the
  warm mark — dark tile, light QR modules, terracotta dot. They were still the
  old dark-blue mark, so an installed icon didn't match the new UI.
- Unified the brand terracotta to `#b0512e` (the AA-safe accent); the inline
  favicon dot was still the brighter `#c6613f`. One terracotta everywhere now.
- Added `npm run gen:icons` (`scripts/gen-icons.mjs`) so the icons are
  reproducible from one source of geometry.

## 0.11.0 — 2026-07-09

Anthropic-inspired visual restyle of both pages — same layout, warmer skin.

### Changed

- Reskinned the sender and receiver with a warm palette adapted from
  anthropic.com: ivory paper (`#faf9f5`), warm near-black ink (`#141413`),
  terracotta accent (`#b0512e`; lighter clay `#d97757` in dark mode), greige
  borders, cream surfaces. The old blue / cool-gray palette is gone. Accent and
  muted-gray tones are tuned to clear WCAG AA (≥4.5:1) as text and under white
  button labels, on both the paper and cream-card backgrounds.
- Brand wordmark now uses a serif display face (Georgia — no proprietary or
  external fonts, so the offline / no-egress CSP is untouched); UI and body text
  stay system-sans for legibility.
- Hoisted colors to `:root` CSS custom properties in each page (one authoritative
  home). Dark mode swaps the token values once via
  `@media (prefers-color-scheme: dark)` instead of overriding each rule.
- `theme-color` is now light/dark-adaptive; the PWA manifest and inline favicon
  were warmed to match.

No behavior, protocol, wire, or feature change — purely visual. The scannable QR
keeps a white background in dark mode, and the camera viewfinder stays black so
it still frames the live image correctly.

## 0.10.4 — 2026-07-09

Tighter receiver copy — same meaning, fewer words.

### Changed

- Trimmed receiver wording at several states (no behavior change): Ready ("Point
  your phone at the animation."), the resume offer, the iOS install tip, the
  insecure-context hint, and the encrypted-transfer privacy note (kept its honest
  "size + that a transfer happened are not hidden" caveat). Receiver-only.

## 0.10.3 — 2026-07-08

Simpler sender: the Playing state now shows only what that step needs.

### Changed

- **While a transfer is playing, the sender hides the idle setup.** It used to
  keep the drop zone, "Add passphrase", "Phone link", and the tagline on screen
  during a send, pushing the QR to the middle of the page. Now Playing shows only
  the transfer view — title, the "visible to anyone" caution, the animated QR, the
  file/ETA plan, the "keep playing until Verified" cue, Stop, and Adjust — like the
  receiver's one-screen-per-state model. **Stop** returns to a clean Idle. No
  wire/protocol/crypto change; the receiver is untouched. Plan: `docs/21`.

## 0.10.2 — 2026-07-08

Platform-correct install hint (Android fix).

### Fixed

- **The receiver's install tip no longer shows iOS-only steps on Android.** It
  previously always read "Share → Add to Home Screen" (the iOS Safari flow),
  which is wrong on Android. Now: on Chromium (Android / desktop) it captures
  `beforeinstallprompt` and offers a real one-tap **Install** button; on iOS it
  keeps the Share → Add to Home Screen tip; anywhere it can neither prompt nor
  give correct steps it shows nothing (instead of another platform's
  instructions). Found via an Android-emulation pass. Receiver-only, no wire
  change.

## 0.10.1 — 2026-07-08

Argon2id is now the default KDF for encrypted transfers.

### Changed

- **Encrypted sends use Argon2id (memory-hard) by default** — the sender's
  "Stronger key (Argon2id)" box is now checked by default. Uncheck it to opt down
  to PBKDF2 for a faster (but GPU/ASIC-weaker) key. This raises the cost of
  brute-forcing a *filmed* ciphertext offline ("harvest now, crack later"). The
  wire format is unchanged and byte-compatible: the receiver already reads both
  KDFs, and existing PBKDF2 transfers keep working. Plaintext sends are unaffected.

### Notes

- Trade-off: Argon2id lazily loads a small WebAssembly module (hash-wasm) and is
  slower than PBKDF2 — negligible on a laptop, ~sub-second on a phone. The
  `wasm-unsafe-eval` CSP directive it needs was already present.
- Deferred (docs/19): Cloudflare-edge response headers (`frame-ancestors`,
  `Referrer-Policy`, `Permissions-Policy`) remain an operator checklist (§5).

## 0.10.0 — 2026-07-08

Security hardening — delivery layer, decoder, and supply chain (see
[docs/19](docs/19-security-hardening-plan.md)). **No wire/protocol/envelope
change** — every existing plaintext and encrypted transfer stays byte-compatible.

### Changed

- **The receiver now forbids all network egress too** (`connect-src 'none'`,
  was `'self'`). The receiver window makes no network request of its own; its
  service-worker precache runs in the worker context, which the page's
  `connect-src` does not govern, so offline still works. "Nothing leaves the
  device" is now browser-enforced on **both** pages, not just the sender.
- **The hosted sender drops `script-src 'unsafe-inline'`** (it serves only
  external scripts — the inline rationale applies only to the offline
  single-file build, which keeps it). Closes an inline-script XSS avenue and
  brings the sender to CSP parity with the receiver.

### Added

- **CBOR decoder depth bound** (`MAX_CBOR_DEPTH = 32`). A deeply-nested hostile
  message could deep-recurse the decoder; nesting is now rejected with a typed
  `CborError` instead of relying on catching a stack overflow. Regression test
  in `web/test/cbor-depth.test.ts`.
- **Supply-chain CI gate** — `.github/dependabot.yml` (weekly npm +
  github-actions updates) and a CI `npm audit --omit=dev --audit-level=high`
  step. Runtime deps run in users' browsers with access to plaintext + the
  passphrase, so high/critical advisories fail the build.

### Notes

- Cloudflare-edge hardening (disable Rocket Loader; add `frame-ancestors`,
  `Referrer-Policy`, `Permissions-Policy` response headers) is an operator
  checklist in `docs/19` §5 — it cannot be set from the repo (GitHub Pages
  serves the site; a `<meta>` CSP is the only in-repo lever).
- Passphrase-strength UX and Trusted Types are queued for **v0.10.1**;
  Argon2id-as-default is recorded as a separate decision.

## 0.9.6 — 2026-07-08

Unified, resolution-proof centering for both pages.

### Fixed

- **The sender and receiver now center identically at any resolution.** The
  receiver used `.screen { flex: 1; justify-content: center }` — a *different*
  centering mechanism from the sender's `.content { margin: auto }`, and one that
  **clips** instead of scrolls when content is taller than the viewport. Switched
  the receiver to the same **`margin: auto`** pattern, so both pages share one
  centering shell. Verified centered (content-block offset 0,0, no scroll) at
  1440×900, **2048×2127** (the reporter's screen), 3440×1440 (ultrawide), and
  480×2000 (tall-narrow); overflow-safe (scrolls, never clips, when content
  exceeds the viewport).

## 0.9.5 — 2026-07-08

Fix the iOS full-height layout (revert the v0.9.4 `svh` mistake).

### Fixed

- **Restored centered content and fixed the iOS scroll-into-empty-space.**
  v0.9.4's `100svh` made iOS Safari render the body *shorter* than the visible
  viewport — content pushed up with a scrollable empty area below (and the
  earlier `100dvh` gave a roughly **2×-tall** scrollable document). Switched both
  pages to the iOS-reliable **percentage-height** pattern: `html { height: 100% }`
  + `body { min-height: 100% }`, which fills the visible viewport without the
  viewport-unit (`vh`/`dvh`/`svh`) over-scroll. Content stays centered; tall
  content (the sender's play stage) still grows and scrolls.

### Notes

- Verified in Chrome (both pages, mobile + desktop): content centered, document
  height equals the viewport (no scroll). The over-scroll is iOS-Safari-specific
  to viewport units, so confirm on the device.

## 0.9.4 — 2026-07-08

Fix iOS over-scroll — the page no longer scrolls into empty space.

### Fixed

- **The page no longer scrolls past its content on iOS Safari.** Both pages
  sized their full-height shell with `min-height: 100dvh`, which on iOS resolves
  to the toolbar-*hidden* height — taller than the visible area when the toolbars
  are shown — so a short screen (e.g. the receiver's result card) became
  scrollable into empty space. Switched to **`100svh`** (small viewport height,
  toolbars shown), which never exceeds the visible area. Tall content (the
  sender's play stage) still grows and scrolls normally.

### Notes

- Verified there is **no CSS overflow** (in Chrome the document height equals the
  viewport); the over-scroll is iOS-Safari-specific to the `dvh`/`vh` unit, which
  `svh` fixes. Confirm on the device.

## 0.9.3 — 2026-07-08

Restore "Share all" alongside "Share .zip" — both, not either.

### Fixed

- **Restored the "Share all" action** on the multi-file card (share the files
  **individually** via the OS share sheet). v0.9.2 wrongly *replaced* it with
  zip-only — that dropped a working feature. The card now offers **both**:
  **Share all** (individual files) and **Share .zip** (one bundled zip, the
  iOS-reliable single-file share), plus **Save .zip** (direct download) and
  Discard. Nothing removed.

## 0.9.2 — 2026-07-08

Multi-file: share the `.zip` through the OS share sheet.

### Changed

- **The multi-file "Share" action now shares a single `.zip` via the OS share
  sheet** — it was "Share all", which tried to share the files *individually*
  (unreliable on iOS, so it only ever downloaded). Sharing **one** zip is the
  reliable path — a single-file Web Share works on iOS where multi-file does not
  — so on iPhone the files now reach Messages / Mail / AirDrop instead of only
  landing in Files. Button relabelled **Share .zip**; **Save .zip** (direct
  download) stays. Found in real-device (iPhone) testing.

## 0.9.1 — 2026-07-08

Concentrate the page content — title joins the centered group.

### Changed

- **The `Blink-Drop` title moved from a top-left corner header into the
  vertically-centered content group** on both pages, so the visual elements are
  grouped together rather than spread across the page (a corner title + centered
  content read as two separate zones). Applied to the sender and the receiver's
  Ready screen; both keep their shared, consistent design. Verified on desktop +
  phone, light + dark.

## 0.9.0 — 2026-07-08

Unified sender + receiver design (consistent style + dark mode on the sender).

### Changed

- **The sender now shares the receiver's design language** so the two pages read
  as one app: a top-left `Blink-Drop` header, vertically-centered content (over-
  flow-safe when the animation grows), the same button/token styles, and **dark
  mode** (`prefers-color-scheme`). Previously the sender was a centered light-only
  hero while the receiver had a header + dark mode. Verified on desktop **and**
  phone, in **light and dark**.

### Notes

- CSS/markup only — no wire, protocol, or logic change; every sender control is
  unchanged (verified in-browser: drop→play, encryption panel, multi-file,
  Adjust sliders). The sender's `<h1>` became a `<header>` banner; still exactly
  one `<main>` landmark (a11y intact).

## 0.8.3 — 2026-07-08

Wording: reflect multi-file support on the sender.

### Changed

- **Drop zone now reads "Drop files, or click"** (was "Drop a file, or click").
  The sender has accepted several files since v0.7, but the copy implied only
  one. Meta description updated to match ("one or more files"). Verified centered
  on both desktop (1440 px) and phone (390 px).

## 0.8.2 — 2026-07-08

Fix off-center disclosure panels on the sender.

### Fixed

- **Sender disclosure panels weren't centered.** The `🔒 Add passphrase` and
  `📱 Phone link` toggles sat in a **side-by-side** row, so each native
  `<details>` opened its panel directly under its own summary — the passphrase
  panel landed roughly centered but the Phone-link QR opened **off to the right**
  (most obvious at phone width). Stacked the two toggles vertically and centered
  them, so both panels now center on the page. Reported by the user; verified at
  390 px (both panels center on the viewport midpoint).

## 0.8.1 — 2026-07-08

Fix a regression in the v0.8.0 simplified sender.

### Fixed

- **Idle screen leaked the playing stage.** The `#stage` block (QR canvas, the
  "keep playing until Verified" cue, Stop, and the Adjust sliders) was meant to
  be `hidden` until a file is chosen — but an id-specificity CSS rule
  (`#stage { display: flex }`) beat the UA `[hidden]` rule, so those controls
  showed on the first screen. Added `#stage[hidden] { display: none; }`. Caught
  by driving the shipped v0.8.0 sender in a browser (`evaluate_script`).
- **Leaner plan line.** The playing summary dropped the byte + frame counts —
  now just `name · ~Ns / loop`.

## 0.8.0 — 2026-07-08

Sender UI simplification — progressive disclosure + minimal copy.

### Changed

- **Simpler first visit.** The sender now shows only the essentials on load —
  title, one line (*"Offline. Nothing uploaded."*), the drop zone, and two
  collapsed toggles (**🔒 Add passphrase** · **📱 Phone link**). Encryption
  (passphrase / strength / Argon2id), the phone-link QR, and the playback
  sliders (**Adjust**) are tucked behind native `<details>` and appear only when
  you want them; the animation + one-line ETA + Stop appear once a file is chosen.
- **Minimal copy.** Every string trimmed; the encryption caveats and the
  strength-hint detail were **relocated** into the encryption panel / tooltips,
  not deleted.
- **Contextual safety note.** The "visible to anyone who can see the screen"
  caution left the first screen — it now shows only when a file is sent
  **without** a passphrase (honest exactly when it matters).

### Notes

- **No feature removed** (everything reachable on demand); no wire, protocol,
  encryption, or CSP change; no new dependency. **Receiver unchanged.** Plan:
  `docs/18-implementation-plan-ui-simplification.md`.

## 0.7.3 — 2026-07-07

Security hardening (external-review response).

### Fixed

- **Untrusted-filename sanitization.** Reconstructed file *bytes* were always
  SHA-256-verified, but the sender-controlled *filename* was used verbatim as a
  download name and **zip entry key**. A crafted name (`../../evil`) is now
  reduced to a safe basename (path components + control chars stripped;
  length-capped) before it reaches the OS share sheet, a download, or a `.zip` —
  closing a low-severity **zip-slip** vector. New `safeName()` helper (`receiver/filename.ts`).
- **Malformed-QR robustness.** `Assembler.receiveQr` could let a `bc-ur`
  exception (`InvalidSchemeError` / internal assertion) escape on a garbled or
  hostile QR frame instead of dropping it — an uncaught throw in the camera scan
  loop. It now returns `false` on any unparseable part. **Found by a new decoder
  fuzz test.**

### Added

- Sender warning: **"Anyone who can see this screen can capture the animation —
  add a passphrase to encrypt sensitive files."** (honest visual-eavesdropping note).
- Decoder **fuzz test** (random bytes / malformed CBOR / malformed UR parts)
  asserting the parser only ever throws typed errors, never an unexpected crash.

### Notes

- Response to an external 12-point security checklist: **10/12 items were already
  handled or are intentional design boundaries** (per-file SHA-256, no-egress CSP,
  KDF/decompression/seq bounds, no auto-open, no payload logging; replay/sender-
  signing are out of scope by design; native-iOS controls are N/A to a PWA).
  Evaluation + rationale: `docs/16-security-review-response.md`. **No wire,
  protocol, or encryption change.**

## 0.7.2 — 2026-07-07

Accessibility + SEO quality pass.

### Fixed

- **Accessibility 98 → 100, SEO 91 → 100** (Lighthouse, mobile). Added a `<main>`
  landmark and a `<meta name="description">` to both the sender and receiver
  pages. No behavior, wire, or script change — HTML `<head>` + one landmark only.

### Notes

- First Lighthouse audit of the live PWA. The remaining "Best Practices"
  deductions are **environmental, not app code**: browser extensions using
  deprecated APIs, and Cloudflare's edge-injected analytics beacon — which the
  app's `script-src 'self'` CSP **correctly blocks** (no-egress by design; the
  console error is that policy working). Optional: turn off Cloudflare Web
  Analytics auto-injection to clear those entries on the live site. Findings:
  `docs/15-implementation-plan-quality-pass.md`.

## 0.7.1 — 2026-07-07

Reliable multi-file delivery on iOS.

### Added

- **"Save .zip" for multi-file receives.** The multi-file result card now offers
  **Save .zip** — the N verified files bundled into one archive — alongside
  **Share all**. iOS Files saves and unzips a single `.zip` cleanly, where
  multi-file Web Share and sequential per-file downloads are unreliable on iOS.
  Colliding filenames are de-duplicated so none is dropped.

### Notes

- Receiver-only: **no wire, protocol, encryption, or security change.** The `.zip`
  is built client-side (`fflate`, pure-JS, no wasm) from the already-verified
  bytes. `fflate` stays **out of** the single-file offline sender bundle
  (`dist-sender/`), which remains dependency-clean. Single-file receives are
  unchanged (direct **Save**). Docs consistency pass folded in (protocol §4.2
  discriminator + KDF/seqLen bounds, roadmap/blueprint/arch/ux multi-file notes).

## 0.7.0 — 2026-07-07

Multi-file transfer.

### Added

- **Send several files in one transfer.** Multi-select or drop multiple files on
  the sender; the receiver **verifies each** (SHA-256) and shares them
  **individually** via the OS share sheet (multi-file Web Share), with a per-file
  download fallback. Encryption seals the whole set and hides the individual file
  names. A single-file transfer is **byte-for-byte unchanged**.

### Protocol / security

- New multi-file envelope (`manifest{0:2}` + payload-list, protocol §4.2); the
  single-file and encrypted formats are unchanged and interoperate. **DEC-2
  security review re-run** for the new wire shape (per-file **and** total
  decompression bounds, a file-count cap, XSS-safe filename rendering;
  architecture update-5).

## 0.6.2 — 2026-07-07

### Security

- **Bounded two receiver DoS vectors** found in a multi-agent security audit
  ([`docs/12-security-audit-v0.6.md`](docs/12-security-audit-v0.6.md)). Both were
  hostile-input → resource-exhaustion, reachable from a single crafted/injected QR
  frame, and availability-only (no confidentiality/integrity impact):
  - **KDF bomb** — an encrypted envelope's KDF cost (PBKDF2 iterations / Argon2
    m,t,p) is now clamped *before* key derivation (which runs before the auth tag
    check), so a huge value can't peg a CPU core or OOM the tab.
  - **UR seqLength bomb** — a crafted part declaring a huge fountain part-count is
    dropped at the assembler boundary before bc-ur allocates `new Array(seqLength)`.
- No protocol/wire change. The audit found **no critical/high** issues; the crypto
  construction, CBOR strictness, XSS-safety, and at-rest key handling were all
  verified sound.

## 0.6.1 — 2026-07-07

### Fixed

- **Progress percentage display.** The receiver's "Collecting …%" (and the v0.6
  resume offer's "Resume …%") showed the raw 0–1 fraction — e.g. "0.34%" for 34% —
  because `percentComplete` is a fraction. Now rendered as a whole percent.
  Cosmetic; present since v0.1, most visible on large/slow transfers.

## 0.6.0 — 2026-07-07

Receiver **resume across restart**. Receiver-only; no protocol or encryption change.

### Added

- **Resume an interrupted scan.** If a large transfer is interrupted (app
  backgrounded, tab closed, phone locked), reopening the receiver offers
  *Resume (X%)* / *Start fresh* instead of restarting from 0%. Only transfers
  above ~40 frames are persisted (small ones finish in seconds).

### Security

- The persisted partial is **encrypted at rest**: the received QR parts are
  AES-GCM-encrypted with a receiver-local **non-extractable** key kept in
  IndexedDB, so **no readable file bytes ever hit disk** for any transfer
  (plaintext or encrypted). Cleared on a verified transfer; expires after 24 h.
  Does not defend against a full-device compromise.

## 0.5.0 — 2026-07-07

Sender polish — the product is now **v1 feature-complete** (every blueprint §9
In-list item shipped). Sender-only; no protocol or encryption change.

### Added

- **Drag-and-drop** — drop a file onto the sender's drop zone to start a transfer
  (click-to-pick still works).
- **Soft-ceiling warning** — a file over ~2 MB shows an honest "this will be slow
  over QR" note; a file over the receiver's ~8 MB decompression cap warns that the
  receiver will refuse it. Advisory only — it never blocks.

### Changed

- Sender intro copy: "Pick or drop a file."

## 0.4.0 — 2026-07-07

Opt-in **Argon2id** key derivation. Additive — the default (PBKDF2) and plaintext
paths are unchanged; v0.3 and v0.4 interoperate.

### Added

- **Argon2id KDF (opt-in).** A "Stronger key derivation (Argon2id)" checkbox on
  the sender derives the key with the **memory-hard Argon2id** KDF (via
  `hash-wasm`) instead of PBKDF2 — far costlier to brute-force offline. The
  receiver auto-detects and decrypts either KDF. PBKDF2 stays the default.
- **Passphrase-strength hint** on the sender — a rough, honest indicator
  (weak / ok / strong), explicitly not a guarantee.

### Security

- The wasm KDF needs `'wasm-unsafe-eval'` in `script-src` (added to both pages).
  It is narrower than `'unsafe-eval'`, and **egress stays forbidden**
  (`connect-src 'none'`/`'self'`) — verified in-browser. DEC-2 review re-run
  (architecture update-3).
- The envelope's kdf-id is versioned; an **unknown KDF fails closed**. AAD binds
  the KDF params (no downgrade). `hash-wasm`'s wasm is base64-embedded, so the
  offline single-file sender remains a single file (no external `.wasm`).

### Notes

- No wire break: plaintext and PBKDF2 envelopes are unchanged. Design:
  `docs/09-implementation-plan-argon2.md`.

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

[0.9.6]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.9.6
[0.9.5]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.9.5
[0.9.4]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.9.4
[0.9.3]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.9.3
[0.9.2]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.9.2
[0.9.1]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.9.1
[0.9.0]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.9.0
[0.8.3]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.8.3
[0.8.2]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.8.2
[0.8.1]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.8.1
[0.8.0]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.8.0
[0.7.3]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.7.3
[0.7.2]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.7.2
[0.7.1]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.7.1
[0.7.0]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.7.0
[0.6.2]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.6.2
[0.6.1]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.6.1
[0.6.0]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.6.0
[0.5.0]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.5.0
[0.4.0]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.4.0
[0.3.0]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.3.0
[0.2.0]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.2.0
[0.1.0]: https://github.com/grammy-jiang/blink-drop/releases/tag/v0.1.0
