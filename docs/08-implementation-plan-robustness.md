# Blink-Drop — Implementation Plan (Robustness / Edge-Case Sweep)

| | |
|---|---|
| **Status** | Implemented (see §6) |
| **Date** | 2026-07-07 |
| **Target release** | none — **tests only**, no version bump (rides the next tagged release) |
| **Scope** | Broaden automated coverage of the shipped protocol core (plaintext + v0.3 encrypted paths) against boundary and adversarial inputs, to de-risk the base before further features. No production-code or wire-format change. |
| **Sources** | `01-protocol.md` (envelope §4/§4.1, integrity §7, compression §8, bomb guard §9); `07-implementation-plan-v0.3-encryption.md` (encrypted path); the existing suites `web/test/{core,crypto,vectors,edge}.test.ts`. |
| **Process note** | This plan was written **after** the code (PR #7) as a correction — the docs-first pipeline (blueprint → architecture → ux → implementation-plan → implementation) expects the plan first. Recorded honestly; future changes get their plan up front. |

---

## 1. Goal

Confidence, not features. The product shipped through v0.3 (sender + PWA receiver + opt-in encryption) but had not yet been tested against boundary inputs (empty, tiny, all-byte-values, unicode names) or the many-fragment + lossy encrypted path. Close that gap with fast, deterministic, device-free tests so later work builds on a proven base.

## 2. Scope and non-goals

**In:** unit/integration tests over `web/src/core` exercising both the plaintext and encrypted envelopes; boundary sizes, non-UTF-8 and unicode metadata, compression-path selection, the empty-passphrase guard, and many-fragment lossy fountain reconstruction under encryption.

**Out (not this change):**
- Any production-code change (this is tests only).
- Performance/throughput measurement (that is the on-device sweep, roadmap M3).
- Real-optics / camera behaviour (needs a device — T8).
- A live multi-megabyte near-cap transfer (too slow for CI; the cap *mechanism* is covered — see §5).

## 3. Edge-case matrix

| Case | Plaintext | Encrypted | What it pins |
|------|:---------:|:---------:|--------------|
| Empty file (0 bytes) | ✓ | ✓ | gzip/store + digest of empty; `orig_size = 0` |
| Single byte | ✓ | ✓ | minimal non-empty framing |
| All 256 byte values | ✓ | ✓ | non-UTF-8 binary through CBOR byte string |
| Unicode/emoji/very long name + empty media type | ✓ | ✓ | CBOR text (UTF-8) round-trip; metadata sealed when encrypted |
| Incompressible ~64 KB | ✓ | ✓ | `compression = 0` path selection |
| Compressible ~200 KB | ✓ | ✓ | `compression = 1` (gzip) path selection |
| Empty passphrase | ✓ (must stay plaintext) | — | the `if (!passphrase)` guard: `""` ⇒ plaintext, not a broken encrypt |
| Empty file over QR | ✓ | ✓ | encode → decode of a 1-part stream |
| Many-fragment (>50), ~20% loss, shuffled | — | ✓ | fountain reconstruction over ciphertext |
| Wrong passphrase on a many-fragment transfer | — | ✓ | fail-closed (`WrongPassphraseError`) after full assembly |

## 4. Task

### T1 — Add the edge-case suite
- **File:** `web/test/edge.test.ts`.
- **Approach:** a `bothPaths(input)` helper round-trips each file through the plaintext *and* encrypted envelopes (asserting bytes + name + media type); QR-framing cases use `encodeFileToQrParts`/`decodeQrPartsToFile` with an optional passphrase. Encrypted cases use a small PBKDF2 work factor (`iterations: 2048`) for speed; production stays at 600k.
- **Acceptance:** all §3 cases pass; the compression-path cases assert the expected `compression` value; the wrong-passphrase case rejects with `WrongPassphraseError`; no production code touched.
- **Verify:** `npm test` (suite grows 36 → **46**), `tsc --noEmit`, `biome check` — all clean; CI green.

## 5. Deferred robustness (future, when justified)

Recorded so the coverage boundary is explicit, not silently assumed:
- **Live near-cap transfer** (~8 MB, the `HARD_MAX_DECOMPRESSED_BYTES` bound) — too slow for CI. The bomb-guard *mechanism* is already covered by `core.test.ts` (a 200 KB→cap gunzip overflow) and the `stored payload exceeds hard ceiling` branch.
- **Malformed/fuzz inputs** beyond the current strict-boundary tests (random CBOR, truncated ciphertext, corrupted UR parts) — a property/fuzz pass could deepen this.
- **Browser-runtime perf** of PBKDF2 600k + large-file AES-GCM on a real phone — belongs with the on-device sweep (roadmap M3).

## 6. Status

**Implemented in PR #7** (`test/edge.test.ts`, 10 cases, suite 36 → 46), merged to `main`. tsc + biome clean; CI green. No version bump — tests only.
