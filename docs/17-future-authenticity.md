# Blink-Drop — Future Direction: Sender Authenticity & Replay Resistance

| | |
|---|---|
| **Status** | **Design memo — NOT scheduled, NOT implemented.** Records *why not now* and *what it would take*, so the reasoning isn't lost. |
| **Date** | 2026-07-07 |
| **Origin** | External security review (`docs/16-security-review-response.md`, concerns #7 replay + #8 fake sender). Both were judged **out of scope by design**; this memo preserves that judgement and its trigger conditions. |
| **Decision** | **No code, no protocol change, no roadmap commitment.** Blink-Drop stays a file-transfer tool. This is the design that *would* apply **if** the product's purpose ever changes (see §5). |

> **This document deliberately changes nothing.** It is a durable record of a decision to *not* build something yet, plus a non-binding sketch of how it would be built if the trigger conditions in §5 are met.

---

## 1. The three security properties

Any "move data from A to B" tool can be judged on three properties. Blink-Drop covers the first two; the third is intentionally absent.

| Property | Meaning | Blink-Drop today | Mechanism |
|---|---|---|---|
| **Confidentiality** | others can't read the content | ✅ opt-in | AES-256-GCM + PBKDF2/Argon2id (`crypto.ts`) |
| **Integrity** | content wasn't corrupted/altered in transit | ✅ always | SHA-256 gate + GCM tag (`envelope.ts`) |
| **Authenticity + freshness** | *who* sent it, and that it's *this* send (not a replay) | ❌ **by design** | — (this memo) |

## 2. Why "encrypted" does not give "authentic"

A common misconception: *encrypted ⇒ safe*. Blink-Drop's encryption is **symmetric** — both sides share one passphrase.

Consequence: **anyone who knows the passphrase can produce a valid ciphertext.** A successful decrypt only proves "whoever built this packet knew the passphrase" — **not which sender built it**. There is no notion of identity.

Integrity (SHA-256 / GCM tag) is the same story: it proves *the bytes didn't get corrupted*, **not** *a trusted party produced them*. A hostile web page or tool, given the passphrase (or for a plaintext transfer, no secret at all), can emit a packet that passes every check.

> Today's guarantees: "the content is intact." What's missing: "the source is trustworthy, and this isn't a rerun."

## 3. The two missing capabilities

### 3a. Sender authenticity — digital signatures (asymmetric crypto)

- The sender signs the transfer with a **private key**; the receiver verifies with a **pinned public key**.
- On success, the receiver *knows* it came from a specific trusted sender — a forger without the private key can't produce a valid signature.
- Addresses review concern **#8 (fake sender)**: today the iPhone **cannot tell** a real Blink-Drop animation from one produced by a malicious page. Signing + pinned keys is what closes that.

### 3b. Replay resistance — receiver challenge / nonce + expiry

- Attack: record the QR animation, **replay** it later; it reconstructs the same payload.
- For a **file**: harmless — you already broadcast it to a screen on purpose; replaying just yields the same file again.
- For a **command / authorization / config**: replay = **re-execution**. Dangerous.
- Fix (review concern **#7**), a challenge–response round-trip:

```text
1. iPhone displays a CHALLENGE QR (a fresh random nonce).
2. Desktop includes that nonce inside the SIGNED transfer.
3. iPhone REJECTS any transfer without the current nonce.
   → a recorded replay fails, because next time the nonce is different.
```

  Optionally reinforced with a **timestamp + expiry** and a **session_id**.

## 4. Why this is intentionally out of scope now

Because **Blink-Drop is a file-transfer tool, not a command/authorization channel.**

- A file has no "execute" semantics — the receiver **saves/shares** it, never "runs" it.
- Replaying a file just re-delivers the same file: **no additional harm.**
- Under that purpose, authenticity and freshness are **not required**; adding them buys complexity (key management, a trust model, identity UI) for no benefit — against the tool's "small and focused" design. This is the standing meaning of **DEC-1** (v1 is symmetric-only; see `blink-drop-architecture-design.md` + `docs/16`).

## 5. Trigger conditions — when this becomes mandatory

This flips from *skippable* to *required* only when Blink-Drop's payload stops being "just a file" and becomes **something that gets executed or trusted**:

- transferring **signed commands**, **auto-applied configuration profiles**, **authorization tokens**, or **transaction instructions**; **or**
- a product requirement to **display a trusted-sender identity** ("this came from *X*").

If any of these become real, review concerns **#7 / #8 graduate from "optional upgrade" to "hard requirement,"** and this memo's §6 becomes the starting point.

## 6. Non-binding v2 sketch (what it would take)

A **protocol-level + product-level** expansion, not a patch:

1. **Asymmetric keys** — e.g. Ed25519 (signatures) / X25519 (key agreement). Note: WebCrypto covers these, but **Ed25519 support is uneven across browsers** — verify before committing; a WASM fallback (like Argon2's) may be needed, re-opening the "single-file offline sender stays blob-free" tension.
2. **Sender identity** — sign the manifest; the receiver **pins trusted sender public keys**; show identity only *after* signature verification (never infer trust from a valid QR format).
3. **Freshness** — receiver-generated **nonce challenge QR** (needs a receiver→sender→receiver round-trip, i.e. a **two-way** flow — a real change from today's one-way broadcast), or timestamp + expiry.
4. **Fallout** — new envelope fields (a signed/authenticated variant, discriminated like the existing key-0 versions), **key management + trust UI**, a **rewritten threat model**, and new test vectors.

> This is a *sketch to anchor future discussion*, not a specification. It changes Blink-Drop from "offline small-file transfer" into "an authenticated transfer channel with a trust model" — a **different product**, and a decision to make deliberately.

## 7. Cross-references
- `docs/16-security-review-response.md` — the review this memo answers (#7, #8).
- `docs/01-protocol.md` §11 — security review (DEC-2), the wire contract that a signed variant would extend.
- `blink-drop-architecture-design.md` — DEC-1 (no v1 confidentiality, since reversed for *symmetric* encryption in v0.3; **authenticity remains excluded**).
- `docs/04-roadmap.md` — deferred backlog (this memo is listed there, not scheduled).

## 8. Explicit non-goals of this document
- Does **not** add or change any code, wire format, or CSP.
- Does **not** put authenticity/replay on the roadmap as committed work.
- Does **not** pick final algorithms — §6 names candidates only, pending the §5 trigger.
