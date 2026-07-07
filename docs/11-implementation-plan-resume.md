# Blink-Drop — Implementation Plan (Resume across restart — shipped v0.6.0)

> **✅ Shipped as v0.6.0 (2026-07-07).** This plan was drafted targeting a "v1.1.0" before the release train was renumbered; resume actually shipped in **v0.6.0** (`CHANGELOG.md`, `04-roadmap.md`, `blink-drop-architecture-update.md` update-4). Read every "v1.1.0" / "v1.1" / "1.0.0-or-1.1.0" reference below as **v0.6.0** — they are pre-ship planning notes, not the shipped version.

| | |
|---|---|
| **Status** | **Shipped v0.6.0** (drafted 2026-07-07) |
| **Date** | 2026-07-07 |
| **Target release** | **v0.6.0** (receiver feature; shipped) |
| **Scope** | Let the **receiver** resume an interrupted scan instead of starting over — persist the partial fountain assembly and continue it on reopen. Receiver-only; **no protocol/wire/encryption change**. |
| **Sources** | `01-protocol.md` §5 (session binding via CRC-32 checksum; dedupe), `web/src/core/ur.ts` (`Assembler` = bc-ur `URDecoder`), `web/src/ui/receiver.ts` (scan loop, state model §14). |

> **Plan for review — no code yet.** §2 lists the real decisions. **D5 (privacy at rest)** is the crux and genuinely yours — persisting parts writes transferred data to disk, a shift from today's in-memory-only model. Confirm §2 before I build.
>
> **Honest framing:** the product targets *small* files (seconds-long transfers), so resume is **modest value** — it matters for large/slow transfers or a phone that backgrounds mid-scan. The plan keeps the scope tight to earn that value without much surface.

---

## 1. Goal

Today an interrupted scan (app backgrounded, tab closed, phone locked) loses all collected fragments — the user restarts from 0%. Resume persists what was collected so reopening continues from where it stopped.

**Approach (why this shape):** the `Assembler` wraps bc-ur's `URDecoder`, whose internal fountain state is not cleanly serializable. The robust, implementation-agnostic form is to **persist the received UR part strings** (the deduped set) and **replay them** into a fresh `Assembler` on resume. Parts are short strings; replay is fast and depends on no bc-ur internals.

## 2. Decisions for review

| # | Decision | Options | Recommendation |
|---|----------|---------|----------------|
| **D1** | What to persist | The received **part strings** (deduped) · the decoder's internal state | **Part strings** — serializable, bc-ur-agnostic, replayable. |
| **D2** | Storage | **IndexedDB** · localStorage | **IndexedDB** — handles many parts / larger volume; localStorage is string-capped (~5 MB) and synchronous. |
| **D3** | Slot / keying | **User-initiated single slot** (one in-progress transfer) · auto-key by transfer checksum | **User-initiated single slot** — on reopen, offer *Resume (X%)* vs *Start fresh*. Avoids extracting the per-part checksum (not cleanly exposed by bc-ur) and the "decoder locks to the wrong session" trap; the user decides. |
| **D4** | Lifecycle | Clear on success + expire after 24 h + one slot · keep many, manual clear | **Clear on success; expire after 24 h; single slot** — a partial is only useful briefly; don't accumulate. |
| **D5** | **Privacy at rest — RESOLVED (2026-07-07)** | encrypted-only · persist-all-plaintext · **at-rest encryption** | **Encrypt the saved partial at rest with a receiver-local non-extractable AES-GCM key** (user-confirmed). *"Encrypted-only" is infeasible* — the `encrypted` flag lives **inside** the fountain-coded message, unreadable until full assembly (too late to resume), so the receiver can't tell mid-scan whether a partial is encrypted. Instead: persist any transfer above the frame threshold (D6), but AES-GCM-encrypt the stored parts with a WebCrypto **non-extractable** key (generated once, kept in IndexedDB as a CryptoKey handle). **No readable file bytes hit disk for any transfer;** forensic IDB reading yields ciphertext only (the key can't be extracted). Does not defend a full-device compromise — nothing local can. |
| **D6** | When to persist | Only when `seqLen > ~40` frames (large enough that resume helps) · always | **Above ~40 frames** — small transfers finish in seconds; not persisting them avoids the disk write entirely and shrinks the D5 surface. |

## 3. Design

- **Storage module** `web/src/receiver/resume.ts` (IndexedDB wrapper + at-rest crypto): `save(partial)`, `load()`, `clear()`. `partial = { parts: string[], percent, savedAt, frames }`, single record (fixed key). **At-rest (D5):** the module gets-or-creates a **non-extractable AES-GCM CryptoKey** stored in IndexedDB; `save` AES-GCM-encrypts the serialized partial, `load` decrypts — no readable plaintext ever persists. Unit-tested with a fake IndexedDB.
- **Capture:** during scanning, each accepted QR string is added to an in-memory `Set`; when `seqLen > threshold`, persist the set (debounced, e.g. every ~1 s or every N new parts) with the current percent.
- **Resume offer:** on receiver open, if a non-expired partial exists → a new **Ready-with-resume** screen: *"Resume last transfer — X% collected"* [Resume] and [Start fresh]. Resume → replay stored parts into a fresh `Assembler`, then start the camera (continues the same session; bc-ur dedupes and rejects any foreign-session part). Start fresh → `clear()` + normal Ready.
- **Completion/failure:** on verified success → `clear()`. On explicit Start over → `clear()`.
- **State model (§14) additions (feedback to architecture):** a `Resumable` entry state and a `Resuming` transient (replaying persisted parts). Recorded as architecture feedback → an update note when this ships.

## 4. Tasks (ordered)

1. **T1 — storage module + at-rest crypto + tests:** `resume.ts` — IndexedDB save/load/clear + expiry + a get-or-create **non-extractable AES-GCM key**; encrypt-on-save / decrypt-on-load. Unit tests (round-trip a partial through encryption, expiry drops stale, clear empties). Headless via `fake-indexeddb`.
2. **T2 — capture + persist:** thread a part `Set` through the scan loop; debounced `save()` above the frame threshold (D6).
3. **T3 — resume UX:** the Ready-with-resume screen (Resume / Start fresh); replay-then-scan on Resume; a *Resuming…* note; clear on success/Start-over.
4. **T4 — privacy copy:** one honest line where relevant (e.g. Start-fresh clears the saved partial; encrypted partials are ciphertext, plaintext ones are file data kept briefly on this device).
5. **T5 — tests + browser:** unit (storage) + browser drive (partial scan → reload → Resume → completes; Start fresh → 0%).
6. **T6 — docs:** receiver architecture note + `blink-drop-ux-design` state addition (Resumable/Resuming) + CHANGELOG; bump to v0.6.0. No security-review re-run needed (no wire change), but §17 gains a **data-at-rest** note (D5).
7. **T7 — on-device** (user): background the receiver mid-scan, reopen, Resume.

## 5. Out of scope
- Any protocol/wire/encryption change. Multi-file. Cross-device resume. Persisting the *sender* side (it has nothing to resume — it just loops).
- Resuming across a *different* transfer (single slot; a new transfer offered Start-fresh replaces it).

## 6. Release checklist (v0.6.0)
1. Branch `feat/v1.1-resume` → T1–T6 → PR (CI green) → merge.
2. Regression: biome, tsc, tests (+ storage tests), PWA + single-file sender builds.
3. Bump `web` → 1.0.0? — **see note.** If v1.0.0 (feature-complete milestone) is cut first, this is 1.1.0; otherwise this itself could be the 1.0.0 line. Decide at release.
4. Tag + GitHub release; Pages redeploys.
5. T7 — user confirms resume on the iPhone.

> **Aside (not this plan):** the top-level `README.md` and `web/README.md` were refreshed in the v0.6 consistency pass (they had said "native iOS receiver"). A **v1.0.0** milestone remains an option independent of this feature.
