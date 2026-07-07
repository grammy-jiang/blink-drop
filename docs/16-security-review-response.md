# Blink-Drop — Security Review Response + Hardening (v0.7.3)

| | |
|---|---|
| **Status** | Draft v0.1 — response to an external security-concerns checklist (2026-07-07) |
| **Target release** | **v0.7.3** |
| **Scope** | Evaluate an externally-supplied 12-point security checklist against the shipped v0.7.2 code, then fix the two items that are genuinely open. Receiver-side hardening + one sender UX line + defense-in-depth tests. **No wire/protocol/encryption change.** |

---

## 1. Evaluation of the external checklist

The document is a competent but **generic** animated-QR-transfer checklist, written **without knowledge of Blink-Drop's actual design**: it assumes a **native iOS app** (Keychain, iOS Data Protection, crash reports, configuration profiles), re-recommends controls that shipped months ago, and invents arbitrary limits (e.g. "max file size 100–300 KB"). Treated as a checklist to cross off, not a findings report.

**Mapping (verified against source):**

| # | Concern | Status | Evidence |
|---|---------|--------|----------|
| 1 | Visual eavesdropping | Real premise, mitigated; **minor UX gap** | opt-in AES-256-GCM (`crypto.ts`, `envelope.ts`); no explicit sender "screen is capturable" note → **Fix B** |
| 2 | File integrity | Handled | CRC-32/frame in UR/MUR (`ur.ts`); SHA-256 gate `finishOpen` → `DigestMismatchError` |
| 3 | Malicious file | Handled by design | no auto-open/send; manual Share/Save/Discard (`receiver.ts`); PWA can't execute |
| 4 | Filename attacks | **Partial — real gap** | XSS-safe `textContent`; but raw name → zip entry key (`bundle.ts`) with no `../` strip (zip-slip); no length cap → **Fix A** |
| 5 | MIME confusion | Handled | `mediaType` advisory, defaults `application/octet-stream`; no in-app preview |
| 6 | Share-sheet leakage | Handled | explicit action, metadata shown, no app auto-selected |
| 7 | Replay | Scope-mismatch (by design) | file tool, not a command/auth channel; no session/nonce by design |
| 8 | Fake sender | Accepted, documented limit | symmetric ⇒ no sender authenticity; signing = deferred asymmetric product |
| 9 | Supply-chain | Strong | static Pages, browser-local, no-egress CSP, pinned lockfile, offline sender bundle |
| 10 | iOS storage | Mostly N/A (PWA) | in-memory blob; resume partial AES-GCM-encrypted at rest (`resume.ts`); no payload logging (verified) |
| 11 | DoS / exhaustion | Handled (v0.6.2 audit) | `MAX_SEQ_LEN`, KDF clamps, bounded `gunzip`, `MAX_FILE_COUNT`, `MAX_TOTAL_DECOMPRESSED_BYTES` |
| 12 | Parser robustness | Handled; **add fuzz** | strict `expect()` fails closed; versioned; invalid-vector tests. Doc suggests fuzzing → **Fix C** (defense-in-depth) |

10/12 already handled or intentional design boundaries. Two real (both low-severity) + one cheap robustness add.

## 2. Fixes

**A — Filename sanitization (`safeName`).** The decoded file *bytes* are SHA-256-verified, but the *name* is attacker-controlled and flows into a **zip entry key** (`bundle.ts`) and OS filenames (`share.ts`). Zip-slip is low-real-world-risk (iOS Files / macOS / modern `unzip` block it) but sanitizing is cheap defense-in-depth ("distrust input"). New pure helper `web/src/receiver/filename.ts`:

```
safeName(raw):
  1. NFC-normalize
  2. basename only — split on / and \, keep the last segment (kills traversal / zip-slip)
  3. strip C0 control chars (0x00–0x1F) + DEL (0x7F)
  4. trim leading/trailing dots + whitespace (no hidden-file / trailing-dot tricks)
  5. empty / "." / ".." → "file"
  6. cap at 200 chars, preserving a short (≤16-char) extension
```

Applied at the OS boundary — **`bundle.ts`** (zip keys, before dedupe) and **`share.ts`** (File name + download name) — and in **`receiver.ts`** display so the shown name matches the saved name. Idempotent, so double application is harmless (defense-in-depth). The name inside the protocol/core is unchanged; sanitization is a **receiver-side** delivery concern only.

**B — Visual-capture note (sender).** For plaintext sends, anyone who can film the screen reconstructs the file. Add one honest line to the sender, tied to the mitigation: *"Anyone who can see this screen can capture the animation — add a passphrase to encrypt sensitive files."*

**C — Decoder fuzz test (defense-in-depth).** Feed random bytes / malformed CBOR / malformed UR parts to `openMessage` / `decodeQrPartsToFiles`; assert the decoder only ever throws the **typed** errors (`MalformedMessageError` / `DigestMismatchError` / `CborError` / assembler-false), never an unexpected crash. Pins concern #12.

## 3. Tasks
1. **T1** — `web/src/receiver/filename.ts` `safeName()` + `web/test/filename.test.ts` (traversal, control chars, unicode, length, empty).
2. **T2** — wire `safeName` into `bundle.ts`, `share.ts`, `receiver.ts`.
3. **T3** — sender visual-capture note in `index.html`.
4. **T4** — `web/test/fuzz.test.ts` decoder fuzz (bounded iterations, deterministic seed via index).
5. **T5** — docs: protocol §9 gains a filename-sanitization bound note; CHANGELOG; bump 0.7.2 → 0.7.3.

## 4. Out of scope (intentional design boundaries — NOT fixed)
- Sender authenticity / signed manifests / pinned keys (#8) — a different asymmetric-trust product; deferred.
- Replay protection / nonce / expiry (#7) — Blink-Drop is a file tool, not a command/authorization channel.
- Native-iOS-only controls (#10 Keychain / Data Protection) — N/A to a PWA.
- Weakening the CSP or `'wasm-unsafe-eval'` — `'wasm-unsafe-eval'` permits only WASM compile (Argon2), not arbitrary eval; kept.

## 5. Release checklist (v0.7.3)
1. Branch `feat/v0.7.3-security-hardening` → T1–T5 → PR (CI green) → merge.
2. Regression: biome, tsc, tests (+ filename + fuzz), PWA + single-file sender builds.
3. Bump `web` 0.7.2 → 0.7.3 + CHANGELOG.
4. Tag `v0.7.3` + release; Pages redeploys.
