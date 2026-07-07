# Blink-Drop — Implementation Plan (v0.4: Argon2id opt-in KDF + strength meter)

| | |
|---|---|
| **Status** | Draft v0.1 — **for review before implementation** |
| **Date** | 2026-07-07 |
| **Target release** | **v0.4.0** (new feature + a CSP change → minor bump) |
| **Scope** | Add **Argon2id** as an *opt-in*, memory-hard KDF alternative to PBKDF2 for the v0.3 encrypted envelope, plus an honest **passphrase-strength meter** on the sender. PBKDF2 stays the **default** (zero-blob); Argon2id is chosen explicitly and pulls a wasm module only then. |
| **Sources** | `07-implementation-plan-v0.3-encryption.md` (envelope, KDF-id versioning, "limitation + upgrade path"); `01-protocol.md` §4.1 (encrypted envelope); v0.2 CSP (`web/vite-csp.ts`, H1). |
| **Depends on** | v0.3 encryption (shipped). The envelope's KDF id is already a versioned field, so this is additive. |

> **This is a plan for review.** §2 lists the real decisions (library, a CSP relaxation, sender UX) with recommendations. Please confirm/adjust §2 before I implement — especially **D2 (CSP)**, which is a genuine security trade-off.

---

## 1. Goal and what changes

PBKDF2 (v0.3) is fine but weaker per-guess against GPU/ASIC crackers than a memory-hard KDF. v0.3 deliberately shipped PBKDF2 to keep the offline single-file sender **blob-free**, and made the KDF id a versioned envelope field precisely so Argon2id could arrive later. This is that follow-on.

- **Opt-in, default unchanged.** No passphrase → plaintext (unchanged). Passphrase + default → PBKDF2 (unchanged). Passphrase + "stronger" selected → **Argon2id**. The KDF id in the envelope records which was used.
- **Lazy.** The Argon2 wasm module is dynamically imported **only** when actually deriving/verifying an Argon2id message, so the default and plaintext paths carry no extra weight.
- **Honest strength meter.** A rough, library-free passphrase-strength hint on the sender — explicitly a hint, never a guarantee.

Non-goals: replacing PBKDF2 as default; changing the cipher (AES-256-GCM stays); any change to the plaintext path or transport framing.

## 2. Decisions for review (grill)

| # | Decision | Options | Recommendation |
|---|----------|---------|----------------|
| **D1** | Argon2 library | `hash-wasm` (Argon2id; **wasm embedded as base64 inside its JS** → no separate `.wasm` file, works in node + browser, MIT) · `argon2-browser` (ships a separate `.wasm`, awkward for the single-file sender) | **`hash-wasm`** — its base64-embedded wasm is what keeps the single-file offline sender a *single file*. **Confirm in T1** that vite bundles it with no external `.wasm` emit. |
| **D2** | CSP for wasm | Relax the receiver + sender CSP `script-src` to add **`'wasm-unsafe-eval'`** (required to instantiate WebAssembly) · keep strict CSP and *don't* ship Argon2 | **Relax, narrowly** — add only `'wasm-unsafe-eval'` (not `'unsafe-eval'`). Trade-off analysis in §4.3. **This is the one real security cost — your call.** |
| **D3** | Sender selection | A checkbox "Stronger key derivation (Argon2id)" next to the passphrase · auto-pick Argon2 when available | **Checkbox, default off** — keeps PBKDF2/default behaviour and makes the wasm cost opt-in and visible. |
| **D4** | Strength meter | Library-free heuristic (length + character-class + rough entropy) · `zxcvbn` (~400 KB, accurate) | **Heuristic, no library** — a small honest hint; `zxcvbn` is too heavy for this app and would bloat the offline sender. |
| **D5** | Argon2id params | OWASP baseline **m=19 MiB, t=2, p=1** · lighter for low-end phones | **m=19 MiB, t=2, p=1**, stored in the envelope so they're tunable per-message and forward-compatible. Tests use tiny params (m≈512 KiB, t=1) for speed. |

## 3. Envelope delta (extends `01-protocol.md` §4.1)

The KDF id already discriminates; add the `argon2id` variant of the enc-params map. Everything else (cipher, nonce, AAD, `[outer, ciphertext]`, metadata-sealed, compress-then-encrypt) is unchanged.

```
outer.6 (enc params), when kdf = argon2id:
  { 1:"argon2id", 2:{ m:uint(KiB), t:uint, p:uint }, 3:salt(16B), 4:"aes-256-gcm", 5:nonce(12B) }
```

- `key = Argon2id(passphrase, salt, m, t, p) → 32 bytes` → the AES-256-GCM key.
- **AAD unchanged:** `dCBOR(outer)` still authenticates all params (now the Argon2 cost params too) — no downgrade.
- **Backward/forward compat:** existing `pbkdf2-sha256` messages are untouched and still open on any v0.3+ build. An `argon2id` message opened by a build **without** Argon2 support fails cleanly (`unsupported kdf` → `MalformedMessageError`), never a mis-accept. Note in the release: both sides need a v0.4 build to use Argon2id.

## 4. Library, offline packaging, and CSP

### 4.1 Library (D1)
`hash-wasm`'s `argon2id()` — isomorphic (Node + browser), wasm embedded as base64 in the JS module (no external `.wasm`). Lazy `import()` in `core/crypto.ts` behind an `deriveKeyArgon2()` that is only reached on the Argon2 path.

### 4.2 Offline single-file sender
Because the wasm is base64-in-JS, `vite-plugin-singlefile` should still produce one `.html`. **T1 must verify** `dist-sender/` emits no separate `.wasm` and the file works offline; if a separate `.wasm` appears, reconsider D1.

### 4.3 CSP trade-off (D2) — the crux
Instantiating WebAssembly requires `'wasm-unsafe-eval'` in `script-src`. Today (v0.2 H1): receiver `script-src 'self'`, sender `script-src 'self' 'unsafe-inline'` — both **forbid** wasm.

- **Cost:** `'wasm-unsafe-eval'` lets the page compile/instantiate wasm. It is **narrower than `'unsafe-eval'`** (no JS `eval`). Its risk matters only if an attacker can already inject a wasm module — i.e. via an XSS foothold. This app is static, same-origin, no-egress, no user-generated DOM injection, so the practical XSS surface is very small.
- **Benefit:** Argon2id raises offline-cracking cost of a captured transfer by orders of magnitude over PBKDF2 for the *same* passphrase.
- **Recommendation:** add `'wasm-unsafe-eval'` **only**, and only because the app's XSS surface is minimal. If you'd rather keep the CSP maximally strict, we **drop Argon2** and instead just raise PBKDF2 iterations + ship the strength meter (a smaller alternative — noted in §8).

## 5. Sender UX (`ui/sender.ts`, `index.html`)
- Passphrase field (v0.3) + a **"Stronger key derivation (Argon2id)" checkbox** (D3), default off; its label notes it adds a one-time in-page module and is slightly slower.
- **Strength meter** (D4): a small bar + word (weak / ok / strong) from a library-free heuristic (length, character classes, a rough log2 estimate). Copy is honest — "a rough hint, not a guarantee; a captured transfer can be attacked offline."
- Passphrase still never stored/logged/in-QR; the checkbox only selects the KDF id passed to `buildMessage`.

## 6. Receiver (`ui/receiver.ts`, `core`)
- No visible change to the prompt. On decrypt, `core` reads the envelope's kdf id; for `argon2id` it lazy-imports the Argon2 module and derives. Wrong passphrase → the same `WrongPassphraseError` / distinct loud state.
- First Argon2 decrypt shows a brief "Deriving key…" note (Argon2 at m=19 MiB is a beat slower than PBKDF2).

## 7. Tests and vectors
- **Unit (`crypto.test.ts`):** Argon2id round-trip; wrong passphrase → `WrongPassphraseError`; PBKDF2 and Argon2id both open; unknown-kdf → `MalformedMessageError`; AAD binds the Argon2 params (tamper `m`/`t` → tag fails).
- **Vector:** `vec-05-encrypted-argon2` — byte-exact framing vector with pinned passphrase/salt/params (Argon2id is deterministic), rebuilt + decrypted in `vectors.test.ts`.
- **Browser:** real-Chrome Argon2 round-trip (wasm instantiates under the new CSP); the receiver UI flow once with Argon2id selected.
- Keep all v0.3 PBKDF2 tests/vectors green.

## 8. Security review (DEC-2 re-run — required)
Wire format + CSP both change, so re-run and record (protocol §11 / architecture update-3):
- New KDF params bound by AAD; unknown-kdf rejected; no downgrade.
- Argon2id params sane (m/t/p) and stored, not hard-coded, for tunability.
- **CSP delta reviewed:** `'wasm-unsafe-eval'` added, `'unsafe-eval'` **not**; document the residual risk (§4.3) and that egress is still `connect-src 'self'`/`'none'`.
- **Smaller alternative if D2 is declined:** keep strict CSP, skip Argon2/wasm, raise PBKDF2 iterations (e.g. 600k → 1.2M) + ship the strength meter. Weaker but zero new attack surface.

## 9. Tasks (ordered)
1. **T1 — dependency + offline/CSP proof:** add `hash-wasm`; confirm single-file sender emits no external `.wasm`; add `'wasm-unsafe-eval'` to `web/vite-csp.ts` (both CSPs). Gate the whole plan on this working.
2. **T2 — core:** `deriveKeyArgon2()` (lazy `import()`); envelope encode/decode for `kdf="argon2id"`; unknown-kdf error path. Plaintext + PBKDF2 unchanged.
3. **T3 — vectors + unit tests** (§7).
4. **T4 — sender UX:** checkbox + strength meter (§5).
5. **T5 — receiver:** kdf-branch + lazy load + "Deriving…" note (§6).
6. **T6 — security review + docs:** DEC-2 re-run; protocol §4.1 add the argon2id params; architecture update-3 (ADR-0010 amended / ADR-0011); CHANGELOG; bump 0.3.0 → 0.4.0.
7. **T7 — browser verify** (real Chrome, both KDFs) + regression + release v0.4.0.
8. **T8 — on-device** (user): an Argon2id transfer end-to-end.

## 10. Out of scope for v0.4
- Replacing PBKDF2 as default (stays default; Argon2 is opt-in).
- scrypt, other ciphers, public-key/recipient crypto, metadata-length hiding (still §11 of the v0.3 plan).
- Per-device auto-tuning of Argon2 params (fixed OWASP baseline, stored per-message).

## 11. Release checklist (v0.4.0)
1. Branch `feat/v0.4-argon2` → T1–T6 → PR (CI green) → merge.
2. Regression: biome, tsc, tests (PBKDF2 + Argon2 + all vectors), PWA + **single-file sender** builds (confirm no external `.wasm`), CSP present with `'wasm-unsafe-eval'`.
3. Bump `web` 0.3.0 → 0.4.0 (+ lockfile); CHANGELOG v0.4.0.
4. Tag `v0.4.0` + GitHub release; Pages redeploys.
5. T8 — user confirms an Argon2id transfer on the iPhone.
