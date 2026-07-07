# Blink-Drop — Implementation Plan (v0.7: Multi-file transfer)

| | |
|---|---|
| **Status** | Draft v0.1 — **for review before implementation** |
| **Date** | 2026-07-07 |
| **Target release** | **v0.7.0** (new capability) |
| **Scope** | Send **several files in one transfer**. Reverses the blueprint's "single file per transfer" (§9 In) / "multi-file" (§9 Out). Sender selects/drops N files; the receiver reconstructs and hands them off. |
| **Sources** | `01-protocol.md` §4 envelope; `07`/`09` encryption; `blink-drop-architecture-update.md`; `12-security-audit-v0.6.md` (the wire format was just audited — a reason to prefer *not* changing it). |

> **Plan for review — no code yet.** **D1 is the crux and genuinely yours:** bundle the files into a single archive and reuse the existing (audited) pipeline unchanged, or extend the wire envelope to carry multiple files natively. They trade UX niceness against wire-format risk. Confirm D1 (and the rest of §2), then I implement.

---

## 1. Goal

Let a user pick (or drag-drop) **multiple files** and transfer them together, instead of one at a time. The product targets small files, so this is "send me these 3 configs / 4 photos," not bulk sync.

## 2. Decisions for review

| # | Decision | Options | Recommendation |
|---|----------|---------|----------------|
| **D1** | **How to carry N files** | **(A) Bundle-as-archive** — the sender zips the selected files into one archive and sends it through the *existing, unchanged, just-audited* envelope; the receiver saves/shares the archive. **(B) Native multi-file envelope** — extend the wire format to carry a list of files; the receiver reconstructs each and can share them individually. | **(A) Bundle-as-archive.** Reuses the entire proven + security-audited pipeline with **no wire change and no DEC-2 re-run**; encryption/Argon2/resume all keep working unmodified (they see one opaque payload). Smallest surface for a security tool. Trade-off: the receiver hands off **one archive** the user unpacks, rather than N separate files. See §3/§4 for (A); Appendix A sketches (B) if you prefer per-file UX. |
| **D2** | Archive format + lib (if A) | **`fflate`** (tiny, zero-dep, pure-JS zip; inlines into the offline single-file sender) · `CompressionStream` (can't — it gzips a stream, not a multi-entry archive) · store-only tar (no dep, but no dedup and unusual on iOS) | **`fflate` zip** — ~8 KB, pure JS (no wasm/blob), well-used; produces a standard `.zip` iOS Files unzips natively. Use **store or low-level deflate** inside the zip since the envelope already gzips the whole thing (avoid double-compression cost). |
| **D3** | Sender input | Multi-select **and** multi-file drop (`<input multiple>` + `dataTransfer.files`) · single only | **Multi-select + multi-drop.** Reuse the existing drop zone; accept N files; show the list + a total size. |
| **D4** | Receiver hand-off (A) | Save/share the single archive (name it clearly, e.g. `blink-drop-bundle-<n>-files.zip`) · try to unpack in-app | **Share/save the archive.** In-app unzip + multi-file Web Share is essentially option (B) — keep it simple; the OS/Files handles the zip. Show "N files · total size" on the result card. |
| **D5** | Size / count limits | Bound the **combined** size against the receiver cap; cap the file count | The **sum** of files (post-zip) is what flows, so the existing soft-ceiling (>2 MB) + hard (>8 MB receiver refuses) apply to the archive. Add a small **max file count** (e.g. 50) + reuse `describeSize` on the archive size. |
| **D6** | Single-file behaviour | One file → still send it raw (not zipped) · always zip | **One file → raw (unchanged).** Only zip when the user picks ≥ 2 files, so single-file transfers are byte-for-byte unchanged and un-surprising. |

## 3. Design (option A — bundle-as-archive, recommended)

- **Sender:** on ≥ 2 files, `fflate.zipSync({ [name]: bytes, … })` (store/low deflate) → one `Uint8Array` → the **existing** `buildMessage` path (optionally encrypted) → animated QR. On 1 file, unchanged. `name` = `blink-drop-bundle-<n>-files.zip`, `mediaType = application/zip`.
- **Receiver:** unchanged transport/verify/encryption/resume — it receives one verified file (the zip) and shares/saves it via the existing Web Share / download. The result card reads "Bundle · N files · <size>". iOS Files unzips it.
- **Encryption:** unchanged — the zip is the payload, so a passphrase encrypts the whole bundle (metadata = the bundle name only; individual names are inside the encrypted zip → an extra privacy win).
- **No protocol/wire change; no security-review re-run** (the payload is opaque bytes, exactly as today). fflate is a new *sender-only* runtime dep; confirm it inlines cleanly into `dist-sender` (like hash-wasm).

## 4. Tasks (option A)

1. **T1 — dep + bundle helper:** add `fflate`; `web/src/core/bundle.ts` (or `ui/`) `zipFiles(files) → { bytes, name }`, pure + unit-tested; confirm no external asset in `dist-sender`.
2. **T2 — sender multi-input:** `<input multiple>` + multi-file drop; collect a file list; zip when ≥ 2; reuse `describeSize` on the archive; a max-count guard (D5); show the file list + total.
3. **T3 — receiver result copy:** detect `application/zip` bundle name → "Bundle · N files"; otherwise unchanged. (No new state; hand-off unchanged.)
4. **T4 — tests:** unit (zip round-trips through build/open; single-file stays raw); browser (drop 3 files → transfer → receiver shows bundle → share).
5. **T5 — docs:** blueprint §9 (multi-file Out→In), `web/architecture.md` sender note, CHANGELOG; bump 0.6.2 → 0.7.0. No protocol/security-review change.
6. **T6 — on-device** (user): send 3 files → iPhone receives the zip → unzip in Files.

## 5. Out of scope
- Per-file individual Web Share / in-app unzip (that is option B / a later step).
- Folder-structure preservation beyond what a flat zip gives.
- Streaming/huge bundles — the small-file target + 8 MB receiver cap still apply to the *combined* size.

## 6. Release checklist (v0.7.0)
1. Branch `feat/v0.7-multifile` → T1–T5 → PR (CI green) → merge.
2. Regression: biome, tsc, tests, PWA + **single-file sender** builds (confirm fflate inlines, no external asset).
3. Bump `web` 0.6.2 → 0.7.0 (+ lockfile); CHANGELOG.
4. Tag `v0.7.0` + GitHub release; Pages redeploys.
5. T6 — user confirms a 3-file transfer on the iPhone.

## Appendix A — option B (native multi-file envelope), if you prefer per-file UX

Extend §4 to a multi-file message (e.g. `[ [meta_1..meta_n], [payload_1..payload_n] ]` with a version marker), receiver reconstructs + SHA-256-verifies each file and shares them via `navigator.share({ files: [File, …] })` (Web Share supports multiple files). **Costs:** a wire-format change → `01-protocol.md` §4 amendment + **DEC-2 security-review re-run** (mirroring encryption/Argon2), more envelope + receiver code, and a new architecture update note. **Benefit:** files land individually on iOS (no unzip), and each is independently verified. Choose this only if the unzip step in (A) is unacceptable.
