# Blink-Drop — Wire Protocol

| | |
|---|---|
| **Status** | Draft v0.1 — the contract |
| **Date** | 2026-07-07 |
| **Depends on** | `00-blueprint.md` (v0.3) — requirements R-SUBSET, R-SELFDESC, R-META, R-INTEGRITY, R-DEDUPE, R-SESSION, R-ADJUST, R-OFFLINE |
| **Governs** | Both `web/` (sender) and `ios/` (receiver). This document is the *only* thing the two sides share besides `shared/test-vectors/`. A change here is a change to both. |
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

**One file = one UR message. One UR part = one QR frame.** The sender emits an endless stream of UR parts (systematic first, then fountain-mixed) and renders each as one QR code. The receiver captures parts in any order, and the UR decoder reconstructs the message once enough distinct parts arrive.

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

- **Message** — the complete dCBOR structure for one file (§4). What UR transports.
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

**Metadata availability (reconciliation with blueprint §6.2).** A single fragment is raw message bytes and is *not* independently CBOR-decodable, so `name`/`media_type` become readable only once the whole message assembles. However, `messageLen` (≈ compressed size) is in *every* part, so the receiver shows a **real byte-size and progress denominator from the first captured part**; the **filename/type appear at reassembly**. Blueprint §6.2's "file name … appear immediately" should be read as "size and progress immediately; name at completion." (Minor blueprint edit tracked — see §13.)

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

- **Algorithm: gzip/DEFLATE (zlib).** Native on both sides (web `CompressionStream('gzip')`, iOS zlib), so the offline single-file sender needs **no wasm/library blob** — which keeps the chosen single-file HTML packaging (OQ-9) trivial. zstd/brotli would compress ~10–20% better on text but each adds a dependency to *both* codebases and complicates offline packaging; not worth it for small files at MVP.
- **Compressed bytes are opaque.** gzip output is *not* required to be byte-identical across implementations (it is not, in general). Integrity never depends on compressed-byte equality — only on `SHA-256(decompressed) == header.sha256`. This is why the SHA-256 is of the *original*, and why test vectors are two-tier (§10).
- `compression = 0` (store) is allowed for already-compressed inputs where gzip would only add overhead; the sender may pick this when gzip fails to shrink the payload.

## 9. Safety bounds (baked into the protocol, not left to implementers)

- **Decompression-bomb guard.** `header.orig_size` is declared up front. The receiver MUST refuse to inflate beyond `orig_size` (and beyond a hard absolute cap, e.g. the blueprint's out-of-scope threshold), aborting to *Failed* if the gzip stream tries to exceed it. Without this, a tiny malicious payload could exhaust receiver memory.
- **Allocation bounds.** `messageLen` and `seqLen` (from any part) let the receiver pre-validate sizes before allocating; absurd values → reject the session.
- **Malformed input is a failure, not a crash.** Invalid Bytewords, non-conforming dCBOR, header missing a required key, or a media type / name that is not well-formed → drop the part or fail the transfer cleanly. Strict at the boundary (blueprint's "crash early / distrust input").

## 10. Conformance & test vectors

`shared/test-vectors/` is the executable contract. Both `web/` and `ios/` MUST pass it in CI. Because gzip is non-deterministic across implementations, vectors are **two-tier**:

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

| Concern | Assessment | Stance / action |
|---------|-----------|-----------------|
| **Confidentiality** | **None in v1, by decision (DEC-1).** The QR animation is readable by any line-of-sight camera or screen recorder; `name`/`media_type` leak in the header too. | Accepted for v1; U2 scope narrowed (blueprint §2). Passphrase encryption is the top v1.1 item and slots in *between file and gzip* in §2's layer model — an additive layer that does not change the framing. |
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

Both implement the *same* MUR spec and pass the same upstream vectors, so a part produced by one decodes in the other. Blink-Drop code on each side wraps only: (a) file → gzip → dCBOR header/message, and (b) Bytewords string ⇄ QR render/decode. The architecture docs decide the QR-generation library (web) and the camera/QR-decode API (iOS), and pin versions.

## 13. Handoff & follow-ups

- **To `docs/web/architecture.md`:** QR-generation library choice; `CompressionStream` usage; canvas render loop at the §6 presentation parameters; single-file offline packaging (OQ-9, chosen); pin `@ngraveio/bc-ur` version.
- **To `docs/ios/architecture.md`:** minimum iOS version (`OQ-3`); camera capture + QR-decode API; SwiftUI surfaces for the §6.2 states; share-sheet export; pin `URKit` version.
- **To `04-roadmap.md`:** the parameter-sweep harness that tunes fragment size / rate (`OQ-4`); the two-tier test-vector generation; M0 browser-receiver prototype uses `@ngraveio/bc-ur` to validate this protocol before any native work (`OQ-8`).
- **Back to `00-blueprint.md` (minor edit):** reconcile §6.2 "file name appears immediately" → "size and progress immediately; name at reassembly" (§4 here). Non-breaking; queued so the blueprint and protocol don't drift.
```
