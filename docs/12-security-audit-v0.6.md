# Blink-Drop — Security Audit (v0.6.1) + Hardening (v0.6.2)

| | |
|---|---|
| **Date** | 2026-07-07 |
| **Audited version** | v0.6.1 |
| **Method** | Adversarial multi-agent review: 5 dimension reviewers (crypto, at-rest key, injection/DoS, XSS/CSP surface, passphrase handling) → **each finding independently refuted** by a skeptic → synthesis. 23 raw findings → **21 refuted, 2 confirmed**. |
| **Outcome** | No critical/high. Two **medium** availability (DoS) gaps, both fixed in **v0.6.2** with boundary clamps mirroring the existing decompression-bomb ceiling (SG-2). |
| **Threat model** | An attacker may (a) film/record the QR animation, (b) inject QR codes into the receiver's camera view, (c) craft a hostile message (malformed CBOR/UR, decompression bomb, hostile metadata), (d) read the device's browser storage at rest. |

---

## Executive summary

The core holds up well. The passphrase-encryption construction is sound and fails
closed (AES-256-GCM authenticated; KDF/cipher params bound into the AAD so they
cannot be silently downgraded; a wrong passphrase is a distinct file-withheld
state, never "accept anyway"). The malicious-content path is gated by bounded
decompression (SG-2) + a SHA-256 acceptance check (SG-1). Metadata is rendered via
`textContent` (no XSS), the CBOR decoder is strict, and the resume partial is
genuinely ciphertext-at-rest under a non-extractable key.

The two confirmed issues are the **same class**: an attacker-controlled *cost/size*
field lifted verbatim from a hostile message reaches a resource-consuming primitive
with **no upper bound** — reachable via a single injected/replayed QR frame, and
**availability-only** (client-side, single-tab, self-recoverable; no
confidentiality/integrity/persistence/egress effect). The codebase already had the
right pattern (`HARD_MAX_DECOMPRESSED_BYTES`); these were two spots it had not been
applied.

## Confirmed findings (fixed in v0.6.2)

### M1 — Unbounded KDF work factor (KDF bomb) · `core/envelope.ts`
On decrypt, the KDF cost was taken verbatim from the envelope: PBKDF2 `iter`
checked only `> 0`; Argon2 `m/t/p` checked only `typeof === number`. Key
derivation runs **before** the AEAD tag can be checked, so a crafted envelope
(`iter ≈ 9e15`, or a huge Argon2 `t`/`m`) burns a CPU core forever / OOMs — even
though its forged tag would ultimately fail.
**Fix:** `deriveKeyForKdf` now requires a plain integer within bounds
(`MAX_PBKDF2_ITERATIONS = 10,000,000`; `MAX_ARGON2 = { m: 256 MiB, t: 16, p: 4 }`,
`p ≥ 1`) before deriving — else `MalformedMessageError`.

### M2 — Unbounded UR `seqLength` (allocation bomb) · `core/ur.ts`
`Assembler.receiveQr` forwarded the raw scanned string into bc-ur with no header
validation; bc-ur bounds `seqLength` only by `≥ 1` and runs `new Array(seqLength)`
on the first part. A single ~60-char QR declaring `seqLength` in the hundreds of
millions allocates multiple GB → OOM (reproduced against bc-ur 1.1.13).
**Fix:** `receiveQr` parses the declared part-count from the UR string and drops
any part with `seqLength > MAX_SEQ_LEN` (262,144 — far above any real transfer)
**before** delegating to bc-ur.

Both fixes have regressions in `web/test/security.test.ts` (huge PBKDF2 iter and
Argon2 `m` rejected pre-derivation; absurd `seqLength` dropped; a real part still
accepted).

## What was checked and found solid (refuted findings)

- **AEAD fail-closed** — GCM tag failure → `WrongPassphraseError`, no plaintext
  released, no leak of which of key/ciphertext/AAD was wrong.
- **Downgrade resistance** — the full cleartext outer header (KDF id, cipher,
  salt, nonce) is the GCM AAD; params can't be swapped without breaking the tag.
- **Decompression-bomb gate (SG-2)** — bounded gunzip, exact size equality, SHA-256
  gate on both plaintext and decrypted paths.
- **Strict CBOR** — rejects indefinite lengths, integers past MAX_SAFE_INTEGER,
  non-uint map keys, floats/unsupported majors, trailing bytes; fatal UTF-8.
- **No XSS** — hostile `name`/`media_type` are rendered via `textContent`, never
  `innerHTML`; the only interpolated value is a numeric percent.
- **At-rest** — resume partial is AES-GCM ciphertext under a **non-extractable**
  IndexedDB key; cleared on success; 24 h expiry.
- **Passphrase hygiene** — never stored/logged/in-QR/in-DOM-dataset; wrong-pass
  withholds the file; strength meter is a client-side hint only.
- **Foreign-session safety** — replaying resume parts into a fresh decoder can't
  contaminate a different transfer (bc-ur session binding rejects foreign parts).

## Residual / not-actioned (hardening nits, no exploit under the threat model)

- CSP lacks `form-action` (no `<form>` in the app; navigation-only directive).
- CBOR decoder is non-canonical on input (duplicate keys last-win, non-shortest
  ints) — the *encoder* is canonical; acceptance never depends on decode canonicity.
- AES-GCM is non-key-committing (partitioning oracle) — no multi-recipient/oracle
  surface in a one-shot offline transfer.
- Resume partial persists across non-success exits until the 24 h expiry (already
  ciphertext-at-rest; low).

These are recorded for completeness; none is scheduled.
