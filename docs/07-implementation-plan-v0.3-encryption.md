# Blink-Drop — Implementation Plan (v0.3: Passphrase Encryption)

| | |
|---|---|
| **Status** | Draft v0.1 |
| **Date** | 2026-07-07 |
| **Target release** | **v0.3.0** |
| **Scope** | Add **opt-in, passphrase-based content confidentiality** to the wire protocol and both surfaces (web sender + PWA receiver). This is the first feature that **reverses a v1 decision (DEC-1)**: v0.1/v0.2 deliberately had no confidentiality; v0.3 adds it as an opt-in layer. |
| **Sources** | `01-protocol.md` v0.1 (envelope §4, integrity §7, compression §8, security review §11); `blink-drop-architecture-design.md` (§17 security, ADR-0007, W3/R-4, DEC-1); `00-blueprint.md` v0.5 (§2 layer model, §9 In/Out, DEC-1). |
| **Reused unchanged** | UR/MUR transport, Bytewords, QR render/scan, the fountain player, the SHA-256 file-acceptance gate. Encryption is **transparent to transport** — it changes the *message envelope* (§4), not the framing below it. |
| **Reverses** | DEC-1 ("no v1 confidentiality"), W3, ADR-0007's "no v1 confidentiality" clause — but only when a passphrase is supplied. Plaintext transfers remain the default and are byte-compatible with v0.1/v0.2. |

---

## 1. Goal and the decision it changes

Give a user the option to protect a transfer's **content** and **metadata** so that someone who films the QR animation, but does not know the passphrase, learns neither the file bytes nor its name/type.

- **Opt-in.** No passphrase → today's plaintext envelope, unchanged. A passphrase on the sender → encrypted envelope. The receiver auto-detects which it is.
- **Symmetric, shared out-of-band.** Sender and receiver agree a passphrase through a human channel (spoken, a separate message). The passphrase is **never** in the QR, never stored, never networked.
- **DEC-1 reversal, scoped.** v0.1's "no confidentiality, UI must not imply privacy" (W3) becomes "optional confidentiality; the UI states precisely what is and isn't protected." This reversal is recorded here and folded into the formal docs when v0.3 ships (§10).

Non-goal for v0.3: public-key / recipient-directed encryption, forward secrecy, sender authentication beyond "holds the passphrase," or hiding *that* a transfer happened / its approximate size. See §11.

## 2. Threat model delta (be honest — this is the whole point)

What the passphrase layer **adds**:

| Protects against | How |
|---|---|
| A bystander filming the screen / a screen recorder reading the content | Content + metadata are AEAD ciphertext; useless without the key |
| The `name` / `media_type` leak called out in protocol §11 | Metadata moves **inside** the encrypted plaintext (§4) |
| Silent tampering of the ciphertext in transit | AEAD authentication tag fails closed → loud "wrong passphrase or corrupted" state |

What it **does NOT** protect (must be stated in the UI, §7 — no overclaiming, the honesty rule from W3 survives the reversal):

- **That a transfer happened, and its approximate size** — ciphertext length ≈ compressed file size; the number of frames is visible. No padding in v0.3 (§11).
- **Timing / channel** — anyone watching the two screens sees the exchange occur.
- **Passphrase strength is the ceiling.** A weak passphrase is brute-forceable offline once someone has the frames. The KDF raises the cost (§3) but cannot rescue a bad passphrase.
- **No sender identity.** Symmetric key = anyone who knows the passphrase can also *produce* a valid encrypted transfer. This is confidentiality + integrity of content, not proof of who sent it.

## 3. Cryptographic construction

Design driver, inherited from gzip and SHA-256: **use only primitives the Web Crypto API provides natively**, so the offline single-file sender still needs **no wasm/library blob** (the OQ-9 packaging stays trivial) and the core stays isomorphic (browser + Node both expose `crypto.subtle`).

| Decision | Choice | Rationale | Reversible? |
|---|---|---|---|
| AEAD cipher | **AES-256-GCM** | Native in WebCrypto; authenticated (tag catches wrong key + tampering); no blob | Yes — `crypto.ts` isolates it |
| Key derivation | **PBKDF2-HMAC-SHA-256**, 600,000 iterations | Native in WebCrypto; OWASP-2023 iteration floor for PBKDF2-SHA256; no blob | Yes (see limitation) |
| Salt | 128-bit, CSPRNG per transfer (`crypto.getRandomValues`) | Fresh salt ⇒ fresh key per transfer even for a reused passphrase | — |
| Nonce (GCM IV) | 96-bit, CSPRNG per transfer | Unique key per transfer already bounds reuse risk; random IV is belt-and-braces | — |
| AAD | The cleartext outer header bytes (KDF + cipher params) | Binds params to the ciphertext — an attacker can't swap salt/iterations/nonce without breaking the tag | — |
| Order | **compress-then-encrypt** (gzip, *then* AES-GCM) | Ciphertext is high-entropy and won't compress; gzip must run first or it's dead weight. **Corrects** the earlier "between file and gzip" hint. | — |

**Known limitation (documented, with an upgrade path).** PBKDF2 is weaker per-guess against GPU/ASIC crackers than a memory-hard KDF (scrypt / Argon2id). We accept PBKDF2 for v0.3 because Argon2 needs a wasm blob that breaks the no-dependency offline packaging. The KDF id is a **versioned field in the envelope** (§4), so a later release can add `argon2id` (behind an opt-in wasm build) without breaking format compatibility. Track as an open question.

**Performance note.** 600k PBKDF2 iterations is well under a second on an iPhone 15 Pro Max and on a desktop; it runs once per transfer on each side. No CSP change — `crypto.subtle` is not a network sink; `connect-src` stays `'none'`/`'self'` (§ v0.2 H1).

## 4. Envelope changes (protocol §4 delta)

Today (unchanged, the default): `message = [ header, payload ]`, `header = { 1:name, 2:media_type, 3:orig_size, 4:sha256, 5:compression }`, `payload = gzip(file)`.

**Encrypted variant.** The metadata that used to leak now lives *inside* the ciphertext, so the outer header carries only what the receiver needs to *attempt* decryption:

```
message   = [ outer, ciphertext ]           ; still a 2-element array

outer     = {                               ; CLEARTEXT — readable before decryption
  0: 1,                                      ; envelope version / "encrypted" marker
  6: {                                       ; enc params
       kdf:    "pbkdf2-sha256",
       iter:   600000,
       salt:   bstr(16),
       cipher: "aes-256-gcm",
       nonce:  bstr(12),
     },
}

ciphertext = AES-256-GCM(key, nonce, inner, aad = cbor(outer))

inner      = gzip_or_store( cbor([ meta, file_bytes ]) )   ; the ENCRYPTED plaintext
meta       = { 1:name, 2:media_type, 3:orig_size, 4:sha256, 5:compression }
```

- **Discriminator.** Plaintext keeps `header` with keys 1–5 and **no key 0**; encrypted uses `outer` with **key `0` present**. The receiver branches on `outer[0]`. (Array length stays 2 for both, so nothing downstream in UR/MUR changes.) Exact key numbers are a proposal here; they are frozen when v0.3 implements and `01-protocol.md` §4 is amended.
- **What still leaks (by construction):** the `outer` map (tiny, fixed shape) and the ciphertext length (≈ compressed size). Everything file-identifying — name, type, exact size, hash — is inside `inner`.
- **`orig_size` for the bomb guard** now lives in `meta` (inside), which is fine: decompression happens *after* decryption, so the bound is available exactly when needed (§5).
- **Backward compatibility:** a v0.2 receiver would see `outer[0]=1`, not find keys 1–5, and fail cleanly at the boundary (it never mis-accepts). A v0.3 receiver handles both. Plaintext transfers between any versions are unaffected.

## 5. Decrypt + verify flow (two independent integrity checks)

```
collect parts → UR decode (CRC-32) → CBOR-decode message
  → is outer[0] == 1 (encrypted)?
      no  → existing plaintext path (§7 protocol): gunzip(bounded) → SHA-256 gate
      yes → prompt passphrase (if not already entered)
          → key = PBKDF2(passphrase, outer.salt, outer.iter)
          → inner = AES-GCM-decrypt(ciphertext, nonce, aad=cbor(outer))
                • tag FAILS → "Wrong passphrase or corrupted" (loud; file withheld; retry)
          → CBOR-decode inner → read meta
          → gunzip(bounded by meta.orig_size, §9 bomb guard)
          → SHA-256(result) == meta.sha256 ?  (defense-in-depth + parity with plaintext path)
                • mismatch → Failed (withheld)
                • match    → Complete (show "Encrypted 🔒 · Verified ✓")
```

Two checks, two distinct failures:
- **GCM tag failure** ⇒ wrong passphrase (overwhelmingly likely) or tampered ciphertext → a *specific* "wrong passphrase" state that invites re-entry, **not** the generic corruption state.
- **SHA-256 mismatch** *after* a valid tag ⇒ genuine plaintext corruption (implementation bug / gzip issue) → the existing loud Failed state.

The receiver can read `outer` (and thus know "this is encrypted") from the **first assembled message**, so it can ask for the passphrase early rather than after collection completes.

## 6. Test vectors (extend `shared/test-vectors/`)

Crypto is randomised (salt, nonce), which fights the tier-1 determinism requirement. Resolution:

- **Tier-1 (framing) encrypted case:** pin the passphrase, salt, and nonce in the fixture so AES-GCM output is byte-deterministic → both implementations MUST reproduce the exact `parts.txt`. Add `passphrase`, `salt`, `nonce` to that vector's `meta`.
- **Tier-2 (round-trip) encrypted case:** random salt/nonce; assert the other side recovers bytes whose SHA-256 equals `meta.sha256`, given the correct passphrase.
- **Wrong-passphrase case:** decrypt with a different passphrase MUST fail on the GCM tag (assert the specific error type, not a generic throw).
- Keep all existing plaintext vectors green (no regression to the default path).

New cases to add: encrypted single-fragment; encrypted multi-fragment (real fountain over ciphertext); wrong-passphrase; encrypted-incompressible (`compression=0` inside). Update `web/scripts/gen-vectors.ts` accordingly (pinned RNG for the deterministic case).

## 7. UX delta (W3 honesty rule survives the reversal)

State maps extend architecture §14; add stories to the ux-design doc when v0.3 is scheduled.

**Sender (`web/src/ui/sender.ts`, `index.html`):**
- Optional **passphrase** field. Empty = plaintext (default, today's behaviour).
- When set: a lock affordance + one honest line — *"Encrypted. The receiver must enter this passphrase. Share it separately, not on screen."* A weak-passphrase hint (length-based, no strength theatre).
- The passphrase never enters the QR, the DOM dataset, storage, or any log.

**Receiver (`web/src/ui/receiver.ts`):**
- On assembling an encrypted message: a **passphrase prompt** state (before verify).
- New **"Wrong passphrase"** state — distinct from corruption `Failed`: message *"That passphrase didn't work,"* Retry (re-enter), file withheld.
- **Complete** for an encrypted transfer shows both badges: **🔒 Encrypted · ✓ Verified**. The result card copy names the honest limits in one line (size/occurrence were visible; content/name were not).
- Plaintext transfers: unchanged UI (no lock, no prompt).

**Honesty guardrails (do not overclaim):** never render "secure"/"private" unqualified; the badge means "content + name hidden from someone who lacked the passphrase," nothing about size, timing, or sender identity.

## 8. Security review (DEC-2 re-run — mandatory)

Protocol §11 / architecture §17.8 both say: **re-run the security review when the wire format changes.** v0.3 changes it, so re-run and record in an updated `01-protocol.md` §11:

- Confirm compress-then-encrypt ordering; note the ciphertext-length side channel (accepted, §2/§11).
- Confirm AAD binds all cleartext params (no salt/nonce/iteration downgrade).
- Confirm nonce uniqueness argument (fresh key per transfer) and CSPRNG sourcing.
- Confirm wrong-passphrase fails closed and withholds the file; no "accept anyway."
- Confirm the passphrase never persists or crosses a boundary; no timing oracle in the compare (GCM tag check is constant-time in the platform impl).
- Re-affirm the decompression-bomb guard operates on the *decrypted* `meta.orig_size`.

## 9. Tasks (ordered)

Each: goal · files · acceptance · how verified. Buildable/testable on Linux + browser automation; the only human step is the on-device optical run (T8).

### T1 — Core crypto module
- **Goal:** `deriveKey(passphrase, salt, iter)`, `encrypt(inner, key) → {nonce, ciphertext}`, `decrypt(ciphertext, key, nonce, aad) → inner`; typed `WrongPassphraseError`. Pure, isomorphic (`crypto.subtle`).
- **Files:** `web/src/core/crypto.ts`, `web/src/core/index.ts` (export).
- **Acceptance:** round-trips arbitrary bytes; wrong key throws `WrongPassphraseError`; AAD mismatch throws.
- **Verify:** Vitest (Node `crypto.subtle`), including a wrong-key and tampered-AAD case.

### T2 — Envelope encode/decode (encrypted variant)
- **Goal:** extend `envelope.ts` to emit/parse the `[outer, ciphertext]` layout; branch on `outer[0]`; keep the plaintext path byte-identical.
- **Files:** `web/src/core/envelope.ts`, `types.ts`.
- **Acceptance:** plaintext vectors unchanged; encrypted message encodes/decodes; a v0.2-shaped message still decodes as plaintext.
- **Verify:** Vitest against old + new vectors.

### T3 — Test vectors
- **Goal:** the §6 vector set (pinned deterministic encrypted case + round-trip + wrong-passphrase).
- **Files:** `shared/test-vectors/*`, `web/scripts/gen-vectors.ts`.
- **Acceptance:** tier-1 encrypted vector reproduces exactly; tier-2 recovers; wrong-passphrase fails on the tag.
- **Verify:** `npm test` (vectors bind both directions).

### T4 — `buildMessage` / `openMessage` wiring
- **Goal:** thread an optional `passphrase` through `buildMessage` (encrypt when present) and `openMessage` (decrypt when `outer[0]==1`); SHA-256 gate runs on the decrypted, decompressed bytes.
- **Files:** `web/src/core/index.ts` (or wherever build/open live).
- **Acceptance:** passphrase in ⇒ encrypted stream out; correct passphrase ⇒ verified original; wrong ⇒ `WrongPassphraseError`.
- **Verify:** Vitest end-to-end (no camera).

### T5 — Sender UI (passphrase + honesty copy)
- **Files:** `web/src/ui/sender.ts`, `web/index.html`.
- **Acceptance:** empty field = plaintext (unchanged); set = encrypted with the honest one-liner; passphrase never in QR/DOM dataset/storage.
- **Verify:** browser automation — encrypt a file, confirm the stream decodes only with the passphrase; grep the DOM/serialised state for the passphrase (must be absent).

### T6 — Receiver UI (prompt + Wrong-passphrase state + badges)
- **Files:** `web/src/ui/receiver.ts`, `receiver.html` (states/CSS).
- **Acceptance:** encrypted detected → prompt; wrong → distinct loud state, file withheld; right → 🔒+✓ result card with honest limits line; plaintext path unchanged.
- **Verify:** browser automation via the synthetic `captureStream` camera driving an encrypted stream; both wrong- and right-passphrase paths.

### T7 — Security review + doc reconciliation
- **Goal:** re-run DEC-2 (§8); apply the doc updates in §10.
- **Files:** `01-protocol.md` (§4 envelope, §11 review), `blink-drop-architecture-update.md` (or a new update note: DEC-1/W3/ADR-0007/R-4 reversal), `00-blueprint.md` (§2 layer order, §9 In-list, DEC-1), `CHANGELOG.md`.
- **Acceptance:** no doc still asserts "no confidentiality" without the v0.3 opt-in caveat; the layer order reads compress-then-encrypt everywhere.
- **Verify:** grep for stale "no v1 confidentiality" / "between file and gzip"; consistency pass (like PR #2).

### T8 — Real-optics acceptance (user)
- **Goal:** iPhone confirms an encrypted transfer end-to-end.
- **Acceptance:** sender with a passphrase → iPhone receiver → prompt → verified → Share; a wrong passphrase shows the loud state and withholds the file.
- **Verify:** user runs it on the iPhone (the one step with no substitute here).

## 10. Docs to update when v0.3 ships

Encryption reverses recorded v1 decisions; do it through the same mechanism as the PWA pivot (an update note, not silent edits to the frozen design):

- **`blink-drop-architecture-*`** — DEC-1, W3, ADR-0007's "no v1 confidentiality", R-4, §17.5, §23.7 "no privacy claims": qualify with the opt-in v0.3 layer. Prefer `architecture --mode update` to produce the note, then `materialize` later.
- **`00-blueprint.md`** — §2 layer model (compress-then-encrypt), §9 move encryption from Out→In, DEC-1 caveat.
- **`01-protocol.md`** — §4 freeze the encrypted envelope; §8 note ordering; §11 record the re-run review.
- **`CHANGELOG.md`** — v0.3.0 entry.

## 11. Out of scope for v0.3 (explicit)

- **Memory-hard KDF (Argon2id / scrypt)** — needs a wasm blob vs. the no-dependency offline packaging; KDF id is versioned so it can arrive later behind an opt-in build.
- **Public-key / recipient-directed encryption, forward secrecy, sender authentication** — symmetric passphrase only.
- **Metadata-length hiding / padding** — ciphertext length ≈ file size is accepted and disclosed.
- **Passphrase transport** — remains a human out-of-band step; the app never carries it.

## 12. Release checklist (v0.3.0)

1. Branch `feat/v0.3-encryption` → T1–T7 → PR (CI green) → merge to `main`.
2. Regression: `biome check`, `tsc`, `npm test` (plaintext + encrypted vectors), PWA build + single-file sender build, CSP still injected.
3. Bump `web/package.json` 0.2.0 → 0.3.0 (+ lockfile); `CHANGELOG.md` v0.3.0 entry.
4. Tag `v0.3.0` + GitHub release; Pages redeploys automatically.
5. T8 — user confirms an encrypted transfer on the iPhone.
