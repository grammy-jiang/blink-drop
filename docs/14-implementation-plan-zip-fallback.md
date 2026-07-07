# Blink-Drop — Implementation Plan (v0.7.1: multi-file "Save .zip")

| | |
|---|---|
| **Status** | Draft v0.1 — user-approved (2026-07-07); receiver-only |
| **Target release** | **v0.7.1** |
| **Scope** | Give the multi-file receiver an **iOS-reliable** delivery: a **"Save .zip"** action that bundles the N verified files into one archive. **Receiver-only; no wire/protocol/encryption change.** |
| **Why** | Multi-file receive on iOS is uncertain — `navigator.share({ files })` with several files isn't guaranteed across iOS versions/targets, and the per-file `<a download>` fallback is iOS-flaky (Safari tends to allow one download at a time). The one thing iOS handles cleanly for many files is a **single `.zip`** (Files saves + unzips it). |

---

## 1. Goal

Keep **"Share all"** (individual multi-file Web Share) as the primary action where it works, and add **"Save .zip"** as the guaranteed fallback: the N already-verified files are zipped client-side into one `.zip` and downloaded — a single file iOS saves to Files and unzips natively. Single-file transfers are unchanged.

## 2. Decisions (resolved)

| # | Decision | Choice |
|---|----------|--------|
| **D1** | Zip library | **`fflate`** — tiny, pure-JS, wasm-free (base64-free); **receiver-only**, so it lands in the PWA bundle, **not** the single-file sender (confirm in T1). `zipSync({ [name]: bytes })`. |
| **D2** | UX | Multi-file card only. Actions: **Share all** (Web Share, primary) · **Save .zip** (bundle) · Discard. Single-file card unchanged. *(v0.9.2 added **Share .zip** — shares the one bundled zip via the OS share sheet, since multi-file Web Share is unreliable on iOS but single-file share works. v0.9.3 kept **Share all** alongside it: the card offers Share all · Share .zip · Save .zip · Discard.)* |
| **D3** | Zip contents | The **decoded, verified** file bytes (post-SHA-256). Store or default deflate — the files were already gzipped over the wire; a normal deflate zip is fine. Name: `blink-drop-<n>-files.zip`. |
| **D4** | Duplicate names | Zip entry keys are filenames; if two files share a name, **dedupe** (`name (2).ext`) so none is dropped. |

## 3. Tasks (ordered)

1. **T1 — dep + zip helper:** add `fflate`; `web/src/receiver/bundle.ts` `zipFiles(files: {name,bytes}[]) → Uint8Array` (dedupe names), pure + unit-tested. Confirm `dist-sender/` gains no fflate (receiver-only) and the PWA build still emits no external asset.
2. **T2 — receiver UX:** the multi-file result card gains a **"Save .zip"** button → `zipFiles` → download `blink-drop-<n>-files.zip`. Single-file card unchanged.
3. **T3 — tests + browser:** unit (zipFiles round-trips via a JS unzip / valid zip header + dedupe); browser (3-file receive → Save .zip → a non-empty `.zip` downloads).
4. **T4 — docs:** `blink-drop-ux-design` multi-file receiver states (Share all / Save .zip); README note; CHANGELOG; bump 0.7.0 → 0.7.1. No wire/security change.
5. **T5 — on-device** (user): receive 3 files → **Save .zip** → Files → unzip → 3 files.

## 4. Out of scope
- Nested folders / paths (flat zip). Zipping single-file transfers (single stays direct). Changing the wire format or the Share-all path.

## 5. Release checklist (v0.7.1)
1. Branch `feat/v0.7.1-zip-fallback` → T1–T4 → PR (CI green) → merge.
2. Regression: biome, tsc, tests, PWA + **single-file sender** builds (confirm no fflate / external asset in `dist-sender`).
3. Bump `web` 0.7.0 → 0.7.1 (+ lockfile); CHANGELOG.
4. Tag `v0.7.1` + release; Pages redeploys.
5. T5 — user confirms Save .zip on the iPhone.
