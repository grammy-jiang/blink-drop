# Blink-Drop — Web Sender Architecture

| | |
|---|---|
| **Status** | Draft v0.1 |
| **Date** | 2026-07-07 |
| **Depends on** | `../01-protocol.md` — the wire contract; `../00-blueprint.md` (v0.6) — §6.1 sender workflow, R-OFFLINE |
| **Governs** | `web/` only. **Must not** reference `ios/`. Shared surface is the protocol + `shared/test-vectors/`. |
| **Scope** | How the sender is built: stack, modules, data flow, offline packaging, testing. The *wire* is fixed by the protocol doc; this is the *implementation* of the sending half. |

> **⚠️ Note (2026-07-07):** Current sender doc, with drifts fixed inline: the QR library is **`qrcode-generator` (kazuhikoarase)** (nayuki's isn't on npm), and the **receiver is now an installable PWA** (TypeScript, reusing `web/src/core`), not a native `ios/` app — so any "`ios/`" counterpart reference below means the PWA receiver. Also: **bc-ur needs `Buffer` + `process` polyfills** in the browser (a required Vite build step). Pivot delta: [`../blink-drop-architecture-update.md`](../blink-drop-architecture-update.md). Since the pivot the sender also gained **opt-in encryption (v0.3) + Argon2id (v0.4)** and **drag-drop + soft-ceiling (v0.5)**; the **PWA receiver's** current design (camera scan → verify → share, encrypted prompt, **resume across restart / encrypted-at-rest**) lives in the update note (§U2–U4) + [`../11-implementation-plan-resume.md`](../11-implementation-plan-resume.md) and [`../07-implementation-plan-v0.3-encryption.md`](../07-implementation-plan-v0.3-encryption.md), pending a dedicated receiver-arch doc.

---

## 0. Decisions resolved

| Ref | Decision | Value |
|-----|----------|-------|
| Stack | UI approach | **Vanilla TypeScript + Vite** (no framework — user-confirmed) |
| OQ-9 | Offline packaging | **Single self-contained HTML file** (user-confirmed) via `vite-plugin-singlefile` |
| — | UR/MUR codec | **`@ngraveio/bc-ur`** (npm, TypeScript) — protocol §12 |
| — | QR generation | **`qrcode-generator` (kazuhikoarase)** (TS port, MIT, zero-dep) — explicit version + mode + ECC control |
| — | Compression | native **`CompressionStream('gzip')`** — protocol §8 |
| — | Digest | native **WebCrypto `crypto.subtle.digest('SHA-256')`** — protocol §7 |
| — | Rendering | **`<canvas>`** + `requestAnimationFrame` |

Everything is client-side and dependency-light: bc-ur and qrcode-generator are the only runtime libs; gzip and SHA-256 are browser built-ins. This keeps the single-file artifact small and the offline story clean (R-OFFLINE).

## 1. Responsibilities

**Does:** take **one or several** files entirely in-browser (multi-select or **drag-drop**; multi-file → the §4.2 envelope) → *optionally encrypt under a passphrase (§8)* → gzip → build the dCBOR envelope → drive bc-ur to produce the endless part stream → render each part as a QR frame → loop at the chosen presentation parameters → show the pre-transfer estimate, cycle counter, controls, a **soft-ceiling warning** for large files, and a static **receiver-URL QR** (so the phone can open the PWA receiver) (blueprint §6.1).

**Does not:** touch the network (no fetch/XHR/WebSocket — enforced, §8), persist the file, know anything about the receiver, or implement any acknowledgment path (one-way channel).

## 2. Tech stack

| Concern | Choice | Why |
|---------|--------|-----|
| Language | TypeScript | Types catch envelope/CBOR field mistakes at compile time; shared vocabulary with the protocol doc |
| Build/dev | Vite | Fast dev loop; `vite-plugin-singlefile` inlines everything into one `.html` for OQ-9 |
| UR/MUR | `@ngraveio/bc-ur` | Reference-tested UR codec (protocol §12); provides `UREncoder` with fountain output |
| QR | `qrcode-generator` (kazuhikoarase) | Lets us force alphanumeric mode + version + ECC-L explicitly (protocol §6); no dependency, tiny |
| Compress | `CompressionStream` | Native gzip, zero dependency (protocol §8) |
| Digest | WebCrypto | Native SHA-256, zero dependency (protocol §7) |
| Render | Canvas 2D | Direct pixel control for QR modules; cheap `requestAnimationFrame` loop |

Exact versions are pinned in `web/package.json` at implementation time (lockfile committed).

## 3. Module map

Deliberately split so the **protocol-facing core is pure and reused by the PWA receiver** unchanged. In v0.1 the receiver is a TypeScript PWA that links the *same* `web/src/core` (one language, one core); a future native receiver would mirror it in Swift.

```
web/
├── index.html                # sender page
├── receiver.html             # PWA receiver page (installable)
├── src/
│   ├── core/                 # PURE, no DOM — reused verbatim by sender AND receiver; unit-tested against shared vectors.
│   │   ├── cbor.ts           #   minimal deterministic CBOR for [header, payload] / [outer, ciphertext] (depth-bounded, v0.10)
│   │   ├── envelope.ts       #   file(s) ⇄ message; single / encrypted / multi-file variants; per-file SHA-256 gate (SG-1)
│   │   ├── ur.ts             #   wrap @ngraveio/bc-ur: message ⇄ UR part stream (the only bc-ur boundary)
│   │   ├── digest.ts         #   SHA-256(original) → header field; verify on the receive path
│   │   ├── gzip.ts           #   CompressionStream wrappers (compress / bounded-decompress, protocol §9)
│   │   ├── crypto.ts         #   opt-in passphrase encryption: AES-256-GCM + Argon2id (default) / PBKDF2 (v0.3/v0.4)
│   │   ├── types.ts          #   Header, Message, protocol constants (keys, compression + KDF enums)
│   │   └── index.ts          #   public API: encode/decode{File,Files}ToQrParts
│   ├── qr/
│   │   ├── render.ts         #   render (qrcode-generator, alphanumeric+ECC-L) + the static receiver-URL QR
│   │   └── scan.ts           #   decode a canvas frame via jsQR
│   ├── player/
│   │   ├── sequencer.ts      #   drive UREncoder; precompute the frame set (Prepared state, L5)
│   │   └── loop.ts           #   rAF loop at {rate, scale}; cycle counter; pause/resume (R-ADJUST)
│   ├── receiver/             #   PWA receiver surface (not part of core)
│   │   ├── camera.ts         #   getUserMedia → video → canvas → jsQR (deduped UR strings)
│   │   ├── share.ts          #   Web Share API + download fallback
│   │   ├── bundle.ts         #   multi-file .zip via fflate
│   │   └── resume.ts         #   resume across restart: partial encrypted at rest (IndexedDB)
│   ├── ui/
│   │   ├── sender.ts         #   sender page entry: §6.1 machine + dropzone/plan/controls wiring
│   │   ├── receiver.ts       #   receiver page entry: scan → progress → verify → share wiring
│   │   ├── debug.ts          #   the receiver.html?debug loopback/stream self-tests
│   │   └── size.ts           #   human-readable byte sizes
│   └── polyfill.ts           #   Buffer + process shims bc-ur needs in the browser
├── scripts/                  # gen-vectors, gen-icons, gen-static-qr
└── test/                     # Vitest: core, crypto, vectors, edge, resume, receiver (+ shared/test-vectors)
```

**Hard boundary:** `core/` never imports from `qr/`, `player/`, `ui/`, or `receiver/`. It is the piece reused verbatim by both the sender and the PWA receiver, and the piece the test vectors bind to.

## 4. Data flow (maps to blueprint §6.1 states)

```
[Idle]    user drops file
   │
   ▼
[Loaded]  core.envelope: gzip → header{name,type,orig_size,sha256,compression} → dCBOR message
          estimate: seqLen from bc-ur, × rate → ETA shown BEFORE playing
   │
   ▼
[Prepared] player.sequencer: precompute frame images (systematic parts + a redundancy set of
           fountain parts) → stable-cadence playback (L5). Show generation progress if perceptible.
   │
   ▼
[Playing]  player.loop: rAF draws frame k, advances at `rate`, scaled by `scale`; cycle counter++
   │  ⇄  [Paused/Adjusted] rate/scale change → re-time ONLY (partition untouched, R-ADJUST); ETA re-derives
   ▼
[Stopped]  user ends (receiver said "got it"); summary; "transfer another"
```

## 5. Offline packaging (OQ-9, R-OFFLINE)

- `npm run build:sender` (`vite build` + `vite-plugin-singlefile`) → **one self-contained `dist-sender/index.html`** with all JS/CSS inlined (bc-ur + qrcode-generator + the Argon2 wasm base64-embedded, no external requests). The Pages build (`npm run build`) emits the multi-file sender `dist/index.html` + PWA receiver `dist/receiver.html` instead.
- Ship it as a build artifact the user saves and copies to any machine — including a cold air-gapped one (U1). Open in any modern browser; it runs with the network cable unplugged.
- **CSP** meta tag forbids any external origin and `connect-src 'none'` — makes "the file never leaves the machine" enforceable, not just promised. (Blueprint privacy claim → mechanically true.)

## 6. Presentation vs. partition (protocol §6, R-ADJUST)

The controls expose exactly the two free knobs and nothing else:
- **Rate** (fps) — retimes the rAF loop.
- **Scale** (on-screen QR size / px per module) — redraws bigger/smaller.

Fragment size (→ symbol version) is chosen once at `Loaded` from the seed default (~600 B, protocol §6) and is **not** a user control — changing it means a new transfer. This is what guarantees the receiver's collected parts survive any comfort adjustment.

## 7. Precompute strategy (L5) & fountain budget

- Systematic parts (`seqNum 1..seqLen`) are finite and precomputed to QR images at `Prepared`.
- Fountain parts (`seqNum > seqLen`) are an endless supply; precompute a **fixed redundancy set** (e.g. `ceil(0.3 × seqLen)` extra) so the loop is a stable, seamless cycle rather than computing QR on every frame. If profiling shows headroom, generate fountain frames lazily within the frame budget (≤ `1/rate` seconds) instead — decided at implementation against the real bc-ur + qrcode-generator cost.

## 8. Security / privacy (blueprint Risk 4/7, protocol §11)

- **No network by construction** — CSP `connect-src 'none'`; no `fetch`/`XHR`/`WebSocket` in the codebase (lint rule). The file is never transmitted anywhere but the screen.
- **No JS `eval`** — `script-src` is `'self'` plus `'wasm-unsafe-eval'` only (for the opt-in Argon2 KDF's WebAssembly, v0.4 below); no arbitrary dynamic code.
- Confidentiality: **opt-in passphrase encryption shipped in v0.3** (reverses DEC-1). It lives in `core/crypto.ts` + the envelope, applied **after gzip** (compress-then-encrypt — ciphertext is incompressible), without touching `qr/` or `player/`; `ui/` gains an optional passphrase field + an honest indicator (never a bare "secure" claim — size/occurrence still leak). A plaintext transfer (no passphrase) is unchanged and claims no confidentiality. Design: [`../07-implementation-plan-v0.3-encryption.md`](../07-implementation-plan-v0.3-encryption.md).
- **v0.4 — opt-in Argon2id KDF.** A stronger, memory-hard key derivation (via `hash-wasm`; its wasm is base64-embedded, so the single-file sender stays a single file, and it is lazy-loaded). Selected by a sender checkbox; PBKDF2 stays the default. It needs `'wasm-unsafe-eval'` in `script-src` (narrower than `'unsafe-eval'`; egress unchanged). See [`../09-implementation-plan-argon2.md`](../09-implementation-plan-argon2.md).

## 9. Testing

- **Unit + conformance (Vitest — ~176 cases, coverage-gated).** The shared `shared/test-vectors/` bind the core both ways: **tier-1 framing** (feed the canonical compressed payload through `core/ur.ts`; assert the `ur:blink-drop/...` strings match `parts.txt` byte-for-byte, protocol §10) and **tier-2 round-trip** (`envelope` encode → decode → `SHA-256 == meta.sha256`). Plus core / crypto / cbor-depth / edge / fuzz / multifile / resume / receiver suites. CI gates coverage (lines 85 / stmts 82 / funcs 77 / branches 77; core 90/90/90/82).
- **Cross-browser E2E (Playwright — chromium + firefox + webkit).** Camera-free optical loopback + a `captureStream` synthetic-camera streamtest + a deterministic **visual-contract** spec + **pixel** screenshots (`web/e2e/`); browsers cached in CI.
- **Mutation testing (Stryker).** On `src/core` (cbor / digest / envelope / ur / gzip; `crypto.ts` intentionally excluded), core ~76%, run **weekly** (not per-PR).
- **Lighthouse a11y gate** in CI (≥0.95). Real-optics is still confirmed manually on the target iPhone; the `receiver.html?debug` loopback/stream self-tests remain the quick local check.

## 10. Handoff

- Pin `@ngraveio/bc-ur` and `qrcode-generator` versions in `web/package.json` (lockfile committed) at first implementation.
- The **sweep harness** (`04-roadmap.md`, OQ-4) drives `player/` headlessly across rate × fragment-size to tune the seed defaults.
- `core/` is the shared, protocol-bound module — treat changes to it as protocol-adjacent (re-run vectors on both sides).
