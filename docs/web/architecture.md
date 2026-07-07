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

**Does:** take a file entirely in-browser (pick or **drag-drop**) → *optionally encrypt under a passphrase (§8)* → gzip → build the dCBOR envelope → drive bc-ur to produce the endless part stream → render each part as a QR frame → loop at the chosen presentation parameters → show the pre-transfer estimate, cycle counter, controls, a **soft-ceiling warning** for large files, and a static **receiver-URL QR** (so the phone can open the PWA receiver) (blueprint §6.1).

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
├── index.html
├── src/
│   ├── core/                 # PURE, no DOM — the protocol envelope. Unit-tested against shared vectors.
│   │   ├── envelope.ts       #   file → gzip → build dCBOR message [header, payload]; and the inverse (for M0 receiver)
│   │   ├── ur.ts             #   wrap @ngraveio/bc-ur: message ⇄ UR part stream
│   │   ├── digest.ts         #   SHA-256(original) → header field; verify on the receive path
│   │   ├── gzip.ts           #   CompressionStream wrappers (compress / bounded-decompress, protocol §9)
│   │   └── types.ts          #   Header, Message, protocol constants (keys, compression enum)
│   ├── qr/
│   │   └── render.ts         #   UR part → uppercase → qrcode-generator(alphanumeric, ECC-L) → canvas; + renderTextToCanvas (the static receiver-URL QR, ECC-M)
│   ├── player/
│   │   ├── sequencer.ts      #   drive UREncoder; precompute the frame set (Prepared state, L5)
│   │   └── loop.ts           #   rAF loop at {rate, scale}; cycle counter; pause/resume (R-ADJUST)
│   ├── ui/
│   │   ├── state.ts          #   §6.1 machine: Idle→Loaded→Prepared→Playing→Paused→Stopped
│   │   ├── dropzone.ts       #   file pick / drag-drop
│   │   ├── estimate.ts       #   frame count × rate → pre-transfer ETA; live update on control change
│   │   └── controls.ts       #   rate + scale sliders; cycle/elapsed display
│   └── main.ts               # wire-up
└── test/                     # Vitest: tier-1 framing + tier-2 round-trip (shared/test-vectors)
```

**Hard boundary:** `core/` never imports from `qr/`, `player/`, or `ui/`. It is the piece the browser receiver (M0) links against unchanged, and the piece the test vectors bind to.

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

- `vite build` + `vite-plugin-singlefile` → **one `blink-drop.html`** with all JS/CSS inlined (bc-ur + qrcode-generator bundled, no external requests).
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

- **Tier-1 framing** (`shared/test-vectors/framing`): feed the canonical compressed payload through `core/ur.ts`, assert the emitted `ur:blink-drop/...` strings match `parts.txt` byte-for-byte (protocol §10). Runs in Vitest, no browser needed.
- **Tier-2 round-trip** (`shared/test-vectors/roundtrip`): `envelope.encode` → `envelope.decode` → assert `SHA-256 == meta.sha256`. Exercises the whole `core/` both ways (the decode path is what M0's receiver uses).
- **Manual/e2e**: the M0 browser receiver (`04-roadmap.md`) is the first real screen→camera test of this sender.

## 10. Handoff

- Pin `@ngraveio/bc-ur` and `qrcode-generator` versions in `web/package.json` (lockfile committed) at first implementation.
- The **sweep harness** (`04-roadmap.md`, OQ-4) drives `player/` headlessly across rate × fragment-size to tune the seed defaults.
- `core/` is the shared, protocol-bound module — treat changes to it as protocol-adjacent (re-run vectors on both sides).
