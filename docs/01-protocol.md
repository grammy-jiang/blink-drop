# Blink-Drop — Wire Protocol

| | |
|---|---|
| **Status** | Draft v0.1 + envelope amendments (§4.1 — v0.3 encryption, v0.4 Argon2id; §4.2 — v0.7 multi-file) |
| **Date** | 2026-07-07 |
| **Depends on** | `00-blueprint.md` (v0.7) — requirements R-SUBSET, R-SELFDESC, R-META, R-INTEGRITY, R-DEDUPE, R-SESSION, R-ADJUST, R-OFFLINE |
| **Governs** | `web/` — the sender **and** the PWA receiver (native `ios/` is deferred). This document is the *only* thing the two sides share besides `shared/test-vectors/`. A change here is a change to both. |
| **Scope** | Defines the bytes on the wire and the rules for producing/consuming them. Does **not** choose UI frameworks, camera APIs, or file-picker mechanics — those are the architecture documents' job. Where this spec says "the library handles X," the specific library is named in §12 and pinned in the architecture docs. |

---

## 0. Decisions resolved here

This document closes the following open questions and records the defaults blessed on 2026-07-07.

| Ref | Decision | Value |
|-----|----------|-------|
| **OQ-1** | Adopt vs. custom stream format | **Adopt** Blockchain Commons **UR / MUR** (Uniform Resources + Multipart UR fountain coding) |
| **OQ-2** | Payload transport mode | **QR alphanumeric mode**, payload as **Bytewords** (UR-native; QR byte mode avoided by design) |
| **OQ-5** | Compression | **gzip/DEFLATE** (zlib), applied to the file *before* framing; treated as opaque bytes |
| **OQ-6** | Integrity digest | **SHA-256** of the *original* file, in the header, verified at end (file layer) — *plus* UR's per-part CRC-32 (transport layer, free) |
| **OQ-7** | Session identity | UR message **CRC-32** groups parts on the wire (library-enforced); the file's **SHA-256** is its durable identity |
| **OQ-10** | Partition vs. presentation | **Partitioning (fragment size → symbol version) is fixed at session start; the presentation knobs (frame rate, physical scale) are independent and freely adjustable.** See §6 |

Deferred to architecture (not decided here): minimum iOS version (`OQ-3` → `docs/ios/`), offline packaging mechanics (`OQ-9` → `docs/web/`, already chosen: single-file HTML), exact tuned fragment size / rate (`OQ-4` → sweep harness, `04-roadmap.md`).

---

## 1. Overview

Blink-Drop adopts **Uniform Resources (UR)** — the Blockchain Commons encoding used in air-gapped hardware wallets — and its **Multipart UR (MUR)** fountain extension. Adopting UR means the hardest parts (fountain coding, part framing, cross-part binding, reassembly, reference-tested codecs on both platforms) are provided by mature libraries; Blink-Drop supplies only the file-level envelope (metadata header, compression, cryptographic verification) and the display/capture loop.

**One transfer = one UR message (one file, or several — §4.2). One UR part = one QR frame.** The sender emits an endless stream of UR parts (systematic first, then fountain-mixed) and renders each as one QR code. The receiver captures parts in any order, and the UR decoder reconstructs the message once enough distinct parts arrive.

Mapping to the blueprint requirements, all satisfied by UR/MUR + a thin file envelope:

| Requirement | How UR/MUR + envelope satisfies it |
|-------------|-------------------------------------|
| R-SUBSET | MUR fountain parts (`seqNum > seqLen`) — any ~`seqLen`+ε distinct parts reconstruct the message, any order |
| R-SELFDESC | Every part carries `seqNum`, `seqLen`, `messageLen`, `checksum` — total size and denominator known from *any single part* |
| R-META | File metadata rides in the message header (§4); recoverable once the message assembles |
| R-INTEGRITY | Per-part CRC-32 (transport) + whole-file SHA-256 in the header (file acceptance) — §7 |
| R-DEDUPE | Parts are content-addressed by `(checksum, seqNum, data)`; the decoder discards repeats |
| R-SESSION | The message CRC-32 in every part groups a transfer; a part with a different checksum belongs to a different message and is ignored |
| R-ADJUST | Rate and physical scale are display-only and independent of the fixed partition (§6) |
| R-OFFLINE | Both libraries are pure client-side code; no network, no service dependency |

## 2. Layer model

```
  SENDER                                                RECEIVER
  ------                                                --------
  original file  ────────────────────────────────────►  original file
      │  gzip (OQ-5)                                          ▲  verify SHA-256 (OQ-6)
      ▼                                                       │  gunzip
  compressed bytes                                       compressed bytes
      │  build header + wrap                                  ▲  read header
      ▼                                                       │
  dCBOR message  = [ header, payload ]  ◄──── §4 ────►   dCBOR message
      │  MUR encode (fountain)                                ▲  MUR decode (fountain)
      ▼                                                       │
  UR parts  ur:blink-drop/seqNum-seqLen/…  ◄── §5 ──►     UR parts
      │  Bytewords (2 chars/byte)                             ▲  Bytewords decode
      ▼                                                       │
  QR alphanumeric symbol  ◄──────── §6 ──────────────►   QR decode
      │  render @ rate × scale                                ▲  camera capture
      ▼                                                       │
  ═══════════════════ screen  ─────photons────►  camera ══════════════════
```

The middle three layers (dCBOR message ⇄ UR parts ⇄ Bytewords) are **entirely handled by the UR library** on each side (§12). Blink-Drop owns only the top (file → gzip → header/CBOR) and the bottom (Bytewords string → QR render / QR decode → Bytewords string).

## 3. Terminology (precise, to kill the §5/§7 ambiguity from blueprint review)

- **Message** — the complete dCBOR structure for a transfer: one file (§4), or several (§4.2). What UR transports.
- **Fragment / partition** — the message split into `seqLen` fixed-size source blocks. **Fragment size is fixed when the transfer starts.**
- **Part** — one MUR unit (§5): a systematic fragment (`seqNum ≤ seqLen`) or a fountain XOR-mix (`seqNum > seqLen`). One part → one QR frame.
- **Symbol version** — the QR size (module count), 1–40. **Determined by the fixed fragment size** (the encoder picks the minimum version that holds one part). Therefore *also fixed* for the session.
- **Presentation parameters** — **frame rate** (frames/sec) and **physical scale** (screen pixels per QR module / on-screen size). **Independent of the partition; freely adjustable mid-transfer** (§6, R-ADJUST).

"Partitioning" (fixed) and "presentation" (adjustable) are now disjoint concepts with disjoint names. `OQ-10` is resolved by construction: the comfort knobs never touch the partition.

## 4. The message (file envelope)

The message is **deterministic CBOR (dCBOR)**, a two-element array:

```
message = [ header, payload ]

header  = {                       ; CBOR map, small (tens of bytes)
  1: tstr  name,                  ; original filename, e.g. "config.yaml"
  2: tstr  media_type,            ; IANA media type, e.g. "application/yaml"
  3: uint  orig_size,             ; ORIGINAL (uncompressed) size in bytes
  4: bstr  sha256,                ; SHA-256 of the ORIGINAL file bytes (32 bytes)
  5: uint  compression,           ; 0 = none, 1 = gzip
}
payload = bstr                    ; the gzip-compressed file bytes (opaque)
```

Notes:
- **Untagged at top level.** Per the UR spec, the top-level CBOR in a UR carries no CBOR tag; the UR *type* string (`blink-drop`, §5) supplies the type. Integer map keys keep the header tiny.
- **`sha256` is of the original**, not the compressed payload — it is the file-acceptance gate (§7) and survives any compression choice.
- **`orig_size` is load-bearing for safety** — it bounds decompression (§9, decompression-bomb guard).
- The header is intentionally minimal; anything not needed to *reconstruct and verify the file* stays out (e.g. no timestamps — they would also break deterministic test vectors).

**Metadata availability (reconciliation with blueprint §6.2).** A single fragment is raw message bytes and is *not* independently CBOR-decodable, so `name`/`media_type` become readable only once the whole message assembles. However, `messageLen` (≈ compressed size) is in *every* part, so the receiver shows a **real byte-size and progress denominator from the first captured part**; the **filename/type appear at reassembly**. Blueprint §6.2's "file name … appear immediately" should be read as "size and progress immediately; name at completion." (Applied in the blueprint — §6.2 now reads "name at reassembly.")

### 4.1 Encrypted variant (v0.3, opt-in — reverses DEC-1; v0.4 adds Argon2id)

When the sender supplies a passphrase, the message is the encrypted envelope
(design + rationale: [`07-implementation-plan-v0.3-encryption.md`](07-implementation-plan-v0.3-encryption.md);
architecture `blink-drop-architecture-update.md` §U2). Everything below the
message — MUR parts (§5), Bytewords, QR — is **unchanged**; encryption is
transparent to transport.

```
message    = [ outer, ciphertext ]          ; still a 2-element dCBOR array
outer      = {                              ; CLEARTEXT — readable before decryption
  0: 1,                                      ; discriminator: 1 = encrypted (absent ⇒ single plaintext §4; 2 ⇒ multi-file §4.2)
  6: { 1:kdf-id, 2:work, 3:salt(16B), 4:"aes-256-gcm", 5:nonce(12B) },
}
ciphertext = AES-256-GCM(key, nonce, inner, aad = dCBOR(outer))
inner      = [ meta, payload ]               ; the §4 plaintext message, sealed
meta       = { 1:name, 2:media_type, 3:orig_size, 4:sha256, 5:compression }
key        = KDF(passphrase, salt, work)     ; KDF chosen by kdf-id (below)
```

- **compress-then-encrypt.** gzip runs first (§8), then AES-GCM — ciphertext is
  incompressible, so §2's layer order is *file → gzip → encrypt → envelope*, not
  "between file and gzip."
- **Metadata sealed.** `name`/`media_type`/`orig_size`/`sha256`/`compression` sit
  inside `inner`, so they no longer leak (unlike the plaintext header). The
  cleartext `outer` carries only KDF/cipher parameters + the version marker.
- **Discriminator.** The top-level first-element map key `0` selects the variant:
  **absent** ⇒ single plaintext (§4, keys 1–5, byte-for-byte unchanged and fully
  backward-compatible); `0:1` ⇒ encrypted (this section); `0:2` ⇒ multi-file (§4.2).
- **AAD.** `dCBOR(outer)` is authenticated (not encrypted), binding the KDF id +
  its params + salt/nonce to the ciphertext — no silent parameter downgrade.
- **KDF variants** (key 1 = `kdf-id`, key 2 = `work`):
  - `pbkdf2-sha256` (v0.3, default) — `work` is the iteration count;
    `key = PBKDF2-HMAC-SHA-256(passphrase, salt, work)`.
  - `argon2id` (v0.4, **opt-in**) — `work` is a `{ m:KiB, t, p }` cost map;
    `key = Argon2id(passphrase, salt, m, t, p)`. Runs in WebAssembly, so the built
    pages add `'wasm-unsafe-eval'` to `script-src` (egress unchanged). Design:
    [`09-implementation-plan-argon2.md`](09-implementation-plan-argon2.md).
  An **unknown `kdf-id` fails closed** — a build without a given KDF never
  mis-accepts. The `work` cost is **clamped** to `MAX_PBKDF2_ITERATIONS` /
  `MAX_ARGON2` before derivation, so a hostile header can't force unbounded work (§9).
- **Two integrity checks on open** (§7): the AES-GCM tag (wrong passphrase or
  tamper → fail closed, file withheld) **and** the SHA-256 gate on the decrypted,
  decompressed bytes. The decompression-bomb bound (§9) reads `orig_size` from the
  *decrypted* `meta`.

### 4.2 Multi-file variant (v0.7 — reverses "single file per transfer")

Sending several files uses a **manifest + payload-list**, discriminated by the
top-level first-element map key `0`: absent → single (§4); `1` → encrypted (§4.1);
`2` → multi-file.

```
multi-file plaintext:  [ manifest{0:2}, [ [meta_1,payload_1], … , [meta_n,payload_n] ] ]
multi-file encrypted:  [ outer{0:1, 6:enc}, ciphertext ]   where inner = the multi-file-plaintext bytes
```

- Each `[meta_i, payload_i]` is exactly the §4 single-file body, so per-file gzip,
  the SHA-256 gate (SG-1), and the decompression bound (SG-2) **reuse the
  single-file path verbatim** — the receiver reconstructs and verifies each file
  independently and shares them individually (multi-file Web Share).
- **Encryption is shape-agnostic (§4.1):** `inner` is "the message to seal" —
  single `[meta,payload]` or multi `[manifest,[…]]`. The passphrase seals the whole
  set and **hides the individual file names** (only the ciphertext length leaks).
- **Bounds:** at most `MAX_FILE_COUNT` (32) files; the **sum** of `orig_size` is
  bounded by the same 8 MB ceiling (SG-2, per-file **and** total).
- **Backward compat:** a single-file transfer is byte-for-byte unchanged; a
  pre-v0.7 receiver opening a multi-file message finds `manifest{0:2}` (no keys
  1–5) and fails cleanly — never mis-accepts.

## 5. The part (MUR) and the UR string

Blink-Drop uses the standard MUR part with **no modification**. Before Bytewords, each part is CBOR:

```
part = [
  uint  seqNum,         ; 1-based; seqNum ≤ seqLen = systematic, seqNum > seqLen = fountain mix
  uint  seqLen,         ; base fragment count (the progress denominator)
  uint  messageLen,     ; total message byte length
  uint  checksum,       ; CRC-32 of the whole message (session binding + reassembly proof)
  bstr  data,           ; one fragment, or the XOR of several (fountain)
]
```

Serialized to a UR string:

```
ur:blink-drop/<seqNum>-<seqLen>/<bytewords-of-part-cbor>
```

- **Custom UR type `blink-drop`.** Valid per the UR grammar (letters/digits/hyphen). The spec forbids reusing `bytes` for real payloads, so we define our own type string. It is *not* registered with Blockchain Commons yet — registration is a courtesy for interop and is a future nicety, not a functional requirement (our two ends agree on the string).
- **Fountain semantics.** `seqNum` 1…`seqLen` are the pure fragments, emitted first. `seqNum > seqLen` are pseudo-random XOR mixes; the mix membership is derived from a deterministic PRNG seeded by `checksum` — so both libraries generate identical parts (they pass the UR reference vectors), which is what makes cross-platform test vectors possible (§10).
- **Bytewords doubles the byte count** into the QR symbol (2 characters per byte). This is UR's portability tax (the price of avoiding QR byte mode, OQ-2). It is real and is already reflected in the blueprint's conservative time table (§8 here).

## 6. QR frame, and the partition/presentation split (R-ADJUST, OQ-10)

Each part's Bytewords string is rendered as **one QR code in alphanumeric mode, lowest error-correction level (L)** — stream-level fountain redundancy replaces symbol-level ECC (blueprint L6).

**Case: the QR carries the UPPERCASED UR string.** QR alphanumeric mode's charset is uppercase-only (`0–9 A–Z space $%*+-./:`), but canonical UR/Bytewords is lowercase. So the sender **uppercases** the `ur:blink-drop/...` string before QR encoding (every character then lands in the alphanumeric set — letters, digits, and `: / - .` are all members); the receiver treats the decoded string case-insensitively (UR is case-agnostic by spec). This is why UR fits alphanumeric mode at all, and it is a mandatory step on both sides.

Three display quantities, two of them free:

| Quantity | Set by | Adjustable mid-transfer? | Touches collected parts? |
|----------|--------|--------------------------|--------------------------|
| **Symbol version** | fixed **fragment size** (encoder picks min version that fits) | **No** — fixed at session start | — |
| **Frame rate** | sender control | **Yes, freely** | No |
| **Physical scale** (px/module, on-screen size) | sender control | **Yes, freely** | No |

This is the clean resolution of `OQ-10`: the two comfort knobs the human feedback loop uses ("slow down", "make it bigger" — blueprint §6.4) are **frame rate** and **physical scale**, and *neither* changes the data, the fragment size, or the symbol version. So the receiver's already-collected parts always stay valid across any comfort adjustment (**R-ADJUST holds with no caveat**). The only thing that would invalidate collected parts is changing the *fragment size* — i.e. how many bytes ride per frame — and that is deliberately **not** a mid-transfer knob; it means starting a new transfer.

**Capacity reality (honest envelope).** Bytewords' 2×-per-byte tax means a QR symbol in the reliable band (≈ v20, alphanumeric-L capacity ≈ 1,250 chars) carries a part of ≈ 600 payload bytes, and ≈ v25 (≈ 1,850 chars) ≈ 900 bytes. So realistic **payload throughput under UR is ≈ 600–900 bytes/frame → ≈ 6–9 KB/s at 10 fps** — the denser end of, and consistent with, the blueprint's conservative time table (which already folds in this tax and fountain over-collection). The headline "8–10 KB/s" is the optimistic edge, not the planning centre.

**Seed parameters** (starting points, tuned by the sweep harness — `04-roadmap.md`, `OQ-4`):

| Parameter | Seed value | Note |
|-----------|-----------|------|
| Fragment size (`maxFragmentLen`) | **~600 bytes** | → ≈ symbol version 20 after Bytewords |
| Frame rate | **8–10 fps** | prior art found rate secondary to density |
| Physical scale | **as large as fits the sender screen** | bigger = easier capture |
| Error-correction level | **L** | loss protection lives in the stream, not the symbol |
| Over-collection ε | plan for **~1.1× `seqLen`** distinct parts | fountain needs slightly more than `seqLen` |

## 7. Integrity model — two checksums, two jobs

Deliberately layered; do not conflate them:

| Layer | Check | Provided by | Job | Strength |
|-------|-------|-------------|-----|----------|
| **Transport** | CRC-32 (in every part) | UR/MUR library | Group parts of one message (R-SESSION); confirm the *reassembly* is self-consistent | Error **detection**, not cryptographic |
| **File acceptance** | SHA-256 (header field 4) | Blink-Drop | Prove the reconstructed **original file** is bit-exact before handing it to the user (R-INTEGRITY) | Cryptographic |

**Receiver acceptance sequence (the only path to a delivered file):**

```
collect parts → UR decode (CRC-32 self-consistent) → CBOR-decode message
  → read header → gunzip payload (bounded by orig_size, §9)
  → SHA-256(result) == header.sha256 ?
        yes → Complete: expose to share sheet
        no  → Failed: discard, surface loudly, never expose
```

A CRC-32 collision or a maliciously injected part cannot cause a *silently wrong* file to be delivered: the cryptographic SHA-256 gate at the file layer catches any mismatch. The worst a bad part can do is waste effort or fail the transfer (a DoS, not a corruption) — see §11.

## 8. Compression (OQ-5)

- **Algorithm: gzip/DEFLATE (zlib).** Native in the browser (`CompressionStream` / `DecompressionStream('gzip')`) on both the sender and the PWA receiver — a future native iOS receiver would use zlib — so the offline single-file sender needs **no wasm/library blob** — which keeps the chosen single-file HTML packaging (OQ-9) trivial. zstd/brotli would compress ~10–20% better on text but each adds a dependency to *both* codebases and complicates offline packaging; not worth it for small files at MVP.
- **Compressed bytes are opaque.** gzip output is *not* required to be byte-identical across implementations (it is not, in general). Integrity never depends on compressed-byte equality — only on `SHA-256(decompressed) == header.sha256`. This is why the SHA-256 is of the *original*, and why test vectors are two-tier (§10).
- `compression = 0` (store) is allowed for already-compressed inputs where gzip would only add overhead; the sender may pick this when gzip fails to shrink the payload.

## 9. Safety bounds (baked into the protocol, not left to implementers)

- **Decompression-bomb guard.** `header.orig_size` is declared up front. The receiver MUST refuse to inflate beyond `orig_size` (and beyond a hard absolute cap, e.g. the blueprint's out-of-scope threshold), aborting to *Failed* if the gzip stream tries to exceed it. Without this, a tiny malicious payload could exhaust receiver memory.
- **Allocation bounds.** `messageLen` and `seqLen` (from any part) let the receiver pre-validate sizes before allocating; absurd values → reject the session. The UR `seqLength` is capped at `MAX_SEQ_LEN` and out-of-range parts are dropped before assembly.
- **KDF-cost clamp (v0.6.2).** Attacker-controlled KDF `work` from the cleartext `outer` header (§4.1) is clamped to sane ceilings — `MAX_PBKDF2_ITERATIONS`, or `MAX_ARGON2 {m,t,p}` — *before* key derivation, so a hostile envelope cannot force unbounded CPU/memory (same resource-exhaustion class as the decompression-bomb guard). Origin: [`12-security-audit-v0.6.md`](12-security-audit-v0.6.md).
- **Malformed input is a failure, not a crash.** Invalid Bytewords, non-conforming dCBOR, header missing a required key, or a media type / name that is not well-formed → drop the part or fail the transfer cleanly. Strict at the boundary (blueprint's "crash early / distrust input").

## 10. Conformance & test vectors

`shared/test-vectors/` is the executable contract. `web/` (sender + PWA receiver) MUST pass it in CI; a future native `ios/` must too. Because gzip is non-deterministic across implementations, vectors are **two-tier**:

```
shared/test-vectors/
  README.md                     # how each side consumes these
  framing/                      # TIER 1 — deterministic, byte-exact both sides
    vec-01-hello/
      message.cbor.hex          #   canonical dCBOR message (header + a CANONICAL, pinned compressed payload)
      parts.txt                 #   expected ur:blink-drop/… strings: seqNum 1..seqLen + pinned fountain parts
      params.json               #   { maxFragmentLen, seqLen, checksum }
  roundtrip/                    # TIER 2 — end-to-end, NOT byte-exact (gzip opaque)
    vec-01-hello/
      input.bin                 #   original file
      meta.json                 #   { name, media_type, orig_size, sha256 }
```

- **Tier 1 (framing).** Given the *canonical compressed payload* embedded in `message.cbor.hex`, the UR/MUR + Bytewords output is fully deterministic (systematic parts, and fountain parts under the checksum-seeded PRNG). Both sides MUST produce exactly `parts.txt`. This pins the framing/codec layer independent of gzip.
- **Tier 2 (round-trip).** Given `input.bin`, each side compresses with its own gzip (bytes may differ), transfers, and the other side MUST recover bytes whose SHA-256 equals `meta.sha256`. This pins the end-to-end behaviour without over-constraining compression.
- **Upstream conformance.** Both libraries independently MUST pass the UR reference unit tests (a spec requirement); Tier 1 is Blink-Drop's *envelope* on top of that.

Vector set MUST include: a tiny text file (single fragment, `seqLen = 1`), a file spanning several fragments (real fountain behaviour), a binary file (non-UTF-8 bytes), and an incompressible file (`compression = 0` path).

## 11. Security review (DEC-2)

Per blueprint DEC-2, the security-review pass runs at the protocol stage. Findings and stances:

> **Re-run for v0.3 (2026-07-07).** The encrypted envelope (§4.1) is a wire-format
> change, so DEC-2 was re-run — full checklist + results in
> `blink-drop-architecture-update.md` §U2.5 (compress-then-encrypt, AAD binding,
> nonce uniqueness, fail-closed AEAD, no-persist passphrase, bomb-guard on the
> decrypted size — all passed). The confidentiality row below is updated accordingly.
>
> **Re-run for v0.7 (2026-07-07).** The multi-file envelope (§4.2) is a wire-format
> change → DEC-2 re-run (`blink-drop-architecture-update.md` §U5): per-file SHA-256
> gate + per-file **and** total decompression bound, the manifest discriminator
> can't be confused with a single message, encryption wraps multi-file transparently
> (AAD unchanged), file-count cap, strict malformed-list handling — all passed. Also
> covered: the v0.6.2 KDF-cost + UR-seqLength DoS bounds (`12-security-audit-v0.6.md`).

| Concern | Assessment | Stance / action |
|---------|-----------|-----------------|
| **Confidentiality** | **None by default (plaintext), by decision DEC-1 — but opt-in passphrase encryption shipped (v0.3).** For a plaintext transfer the QR animation is readable by any line-of-sight camera or screen recorder, and `name`/`media_type` leak; an encrypted transfer seals both. | Accepted for v1; U2 scope narrowed (blueprint §2). Opt-in passphrase encryption is the **v0.3** release — designed in [`07-implementation-plan-v0.3-encryption.md`](07-implementation-plan-v0.3-encryption.md). **Ordering correction:** it slots in *after* gzip (**compress-then-encrypt** — ciphertext is incompressible, so gzip must run first) and encrypts the metadata header too; the earlier "between file and gzip" phrasing is refined there. Transport framing (UR/MUR/Bytewords/QR) is unchanged. |
| **File integrity** | Strong. SHA-256 file-acceptance gate (§7) makes silent corruption/undetected tampering infeasible; CRC-32 is only a transport aid and is never trusted for acceptance. | No change. Keep SHA-256 mandatory and end-gated. |
| **Frame injection / DoS** | An attacker who can place QR codes in the receiver's view can inject parts with a forged matching `checksum`, causing failed reassembly or wasted effort. They **cannot** cause a wrong file to be *accepted* (SHA-256 gate). | Accepted as a DoS-only risk; the receiver already treats verification failure as *Failed → keep scanning / restart*. Document that the receiver must not get wedged on injected parts (bounded state, §9). |
| **Decompression bomb** | A small `compression=1` payload could inflate to exhaust memory. | **Mitigated in-protocol** by the `orig_size` bound + hard cap (§9). Mandatory. |
| **Session confusion** | Two transfers in view: parts are grouped by `checksum`, foreign parts ignored (R-SESSION). | Handled by UR; receiver locks to the first checksum it commits to (blueprint §6.5). |
| **Dual-use / exfiltration** | Out of protocol scope; a product-posture matter. | Recorded as blueprint Risk 7; nothing to enforce in the wire format. |

No finding blocks implementation. Two items are **mandatory protocol requirements**, not optional: the SHA-256 end-gate (§7) and the decompression bound (§9).

## 12. Library binding (handoff to architecture)

The adopt decision names specific reference-tested libraries; exact versions are pinned in the architecture docs, not here.

| Side | Library | Language | Role |
|------|---------|----------|------|
| `ios/` | **URKit** (`BlockchainCommons/URKit`, Swift Package Manager) | Swift | UR/MUR encode+decode; the reference implementation |
| `web/` | **bc-ur** (`@ngraveio/bc-ur`, npm) | TypeScript | UR/MUR encode+decode; passes the UR reference vectors |

Both implement the *same* MUR spec and pass the same upstream vectors, so a part produced by one decodes in the other. Blink-Drop code on each side wraps only: (a) file → gzip → dCBOR header/message, and (b) Bytewords string ⇄ QR render/decode.

> **Update (2026-07-07):** The shipped v0.1 receiver is a **PWA** using **`@ngraveio/bc-ur`** (the same `web/` codec as the sender) with **getUserMedia + jsQR** for capture — not URKit. The `ios/` URKit row above and the iOS handoff in §13 are the **deferred native-iOS reference** (no Mac). The wire contract in this document is transport-neutral and unchanged. See [`blink-drop-architecture-update.md`](blink-drop-architecture-update.md).

## 13. Handoff & follow-ups

- **To `docs/web/architecture.md`:** QR-generation library choice; `CompressionStream` usage; canvas render loop at the §6 presentation parameters; single-file offline packaging (OQ-9, chosen); pin `@ngraveio/bc-ur` version.
- **To `docs/ios/architecture.md`:** minimum iOS version (`OQ-3`); camera capture + QR-decode API; SwiftUI surfaces for the §6.2 states; share-sheet export; pin `URKit` version.
- **To `04-roadmap.md`:** the parameter-sweep harness that tunes fragment size / rate (`OQ-4`); the two-tier test-vector generation; M0 browser-receiver prototype uses `@ngraveio/bc-ur` to validate this protocol before any native work (`OQ-8`).
- **Back to `00-blueprint.md`:** §6.2 reconciled — "file name appears immediately" now reads "size and progress immediately; name at reassembly" (§4 here). Applied.
```
