# Blink-Drop — Implementation Plan (v0.7: Multi-file transfer, native envelope)

| | |
|---|---|
| **Status** | Draft v0.2 — **D1 resolved: native multi-file envelope (user-confirmed 2026-07-07)** |
| **Date** | 2026-07-07 |
| **Target release** | **v0.7.0** (new capability + wire-format change) |
| **Scope** | Send **several files in one transfer**, each independently verified; the receiver shares them **individually** (multi-file Web Share). Reverses the blueprint's "single file per transfer" (§9 In) / "multi-file" (§9 Out). |
| **Sources** | `01-protocol.md` §4 envelope; `07`/`09` encryption; `12-security-audit-v0.6.md`. **Reopens the wire format → a DEC-2 security-review re-run is required (T6).** |

> **D1 chosen: native multi-file envelope** (per-file UX over the simpler zip bundle). This is a wire-format change; the plaintext single-file and encrypted formats stay **byte-for-byte unchanged**, and encryption wraps multi-file transparently.

---

## 1. Goal

Pick/drag **multiple files** → transfer together → the receiver verifies each and hands them off as **separate files** (they land individually on iOS via `navigator.share({ files: [...] })`, no unzip). Small-file target; the receiver cap applies per file and to the total.

## 2. Decisions (resolved)

| # | Decision | Choice |
|---|----------|--------|
| **D1** | Carry N files | **Native multi-file envelope** (user-confirmed). Files verified + shared individually. |
| **D2** | Envelope shape | A **manifest + payload-list** variant, discriminated by header key `0` (see §3). Single-file + encrypted shapes unchanged. |
| **D3** | Encryption × multi-file | **Transparent** — the multi-file structure becomes the AES-GCM `inner`; the passphrase seals the whole set (and hides the individual file names). No change to the crypto/AAD. |
| **D4** | Sender input | Multi-select (`<input multiple>`) + multi-file drop → `FileInput[]`; show the file list + total. |
| **D5** | Receiver hand-off | Multi-file result card (list N files); **Share all** via `navigator.share({ files })` + per-file Save; download-link fallback (share one, then next) where multi-file share is unsupported. |
| **D6** | Single file | 1 file → the **existing single-file envelope, unchanged** (only ≥ 2 files use the multi-file shape). |
| **D7** | Limits | Per-file bomb bound (existing) **plus a total-decompressed cap** across files; a max file count (e.g. 32). |

## 3. Envelope design (extends `01-protocol.md` §4)

Discriminator is the top-level first-element map key `0`: **absent → single plaintext (unchanged); `1` → encrypted; `2` → multi-file.**

```
single plaintext (unchanged):  [ header{1:name,2:media,3:size,4:sha,5:comp}, payload ]
encrypted (unchanged):         [ outer{0:1, 6:enc-params}, ciphertext ]
multi-file plaintext (NEW):    [ manifest{0:2}, [ [meta_1,payload_1], … , [meta_n,payload_n] ] ]
multi-file encrypted (NEW):    [ outer{0:1, 6:enc-params}, ciphertext ]
                                 where inner = the multi-file-plaintext bytes above
```

- Each `[meta_i, payload_i]` is exactly the existing single-file body (`meta` = the §4 header; `payload` = gzip-or-store). So per-file **gzip, SHA-256 gate (SG-1), and bomb bound (SG-2) reuse the existing code path** verbatim.
- **Encryption is unchanged and shape-agnostic:** `inner` is "the message to seal" — it may be `[meta,payload]` (single) or `[manifest{0:2}, [...]]` (multi). Decrypt → decode `inner` → dispatch on its key-0. AAD (the cleartext outer) is untouched.
- **Backward/forward compat:** a pre-v0.7 receiver opening a multi-file message finds `manifest{0:2}`, no keys 1–5, and fails cleanly (never mis-accepts). Single-file transfers between any versions are identical.

## 4. Core API

- `buildFilesMessage(inputs: FileInput[], opts): Promise<Uint8Array>` — 1 input → identical to `buildMessage` (single); ≥ 2 → the multi-file shape; encryption applies to the whole (opts unchanged).
- `openFilesMessage(message, opts): Promise<DecodedFile[]>` — returns **all** files (single → length 1, multi → N), each SHA-256-verified. `openMessage` (single) stays for back-compat/tests.
- Total cap: sum of `orig_size` across files bounded (reject a multi-file whose declared total exceeds a hard total), plus per-file bomb bound as today.

## 5. Tasks (ordered)

1. **T1 — protocol §4.2 spec:** freeze the multi-file envelope (manifest key 0=2; payload-list; encryption wraps it; per-file + total bounds).
2. **T2 — core:** `buildFilesMessage` / `openFilesMessage`; a `manifest` marker in types; per-file verify (reuse `finishOpen`); total-decompressed cap; unknown/oversized/malformed multi-file arrays fail closed. Single + encrypted single paths unchanged.
3. **T3 — vectors + unit tests:** a byte-exact multi-file framing vector; tests (2- and 3-file round-trip plaintext + encrypted; one hostile file in the set fails only that open; total-cap rejection; single-file byte-identical to before).
4. **T4 — sender UX:** `<input multiple>` + multi-file drop → `FileInput[]`; file-list + total display; `describeSize` on the total; max-count guard.
5. **T5 — receiver UX:** `openFilesMessage`; multi-file result card (N files); **Share all** (`navigator.share({ files })`) + per-file Save + fallback; `share.ts` gains a multi-file share.
6. **T6 — security review (DEC-2 re-run) + docs:** re-run for the new wire shape (per-file SHA-256 gate; per-file + total bomb bound; discriminator can't confuse single decode; encryption-wraps-multi; strict malformed handling) → record in `01-protocol.md` §11 + a new architecture **update-5** + ADR; blueprint §9 (multi-file Out→In); CHANGELOG; bump 0.6.2 → 0.7.0.
7. **T7 — on-device** (user): send 3 files → iPhone → each lands individually via the share sheet.

## 6. Out of scope
- Folder-structure / nested paths (flat file set only).
- Per-file *resume* granularity (resume still persists the whole partial, unchanged).
- Streaming/huge bundles — the small-file target + the receiver cap (now per-file **and** total) still apply.

## 7. Release checklist (v0.7.0)
1. Branch `feat/v0.7-multifile` → T1–T6 → PR (CI green) → merge.
2. Regression: biome, tsc, tests (single + multi, plaintext + encrypted, vectors), PWA + single-file sender builds.
3. Bump `web` 0.6.2 → 0.7.0 (+ lockfile); CHANGELOG; **DEC-2 re-run recorded**.
4. Tag `v0.7.0` + GitHub release; Pages redeploys.
5. T7 — user confirms a 3-file transfer on the iPhone.
