# Blink-Drop — Implementation Plan (v1.1: Resume across restart)

| | |
|---|---|
| **Status** | Draft v0.1 — **for review before implementation** |
| **Date** | 2026-07-07 |
| **Target release** | **v1.1.0** (receiver feature) |
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
| **D5** | **Privacy at rest (the crux)** | Persist for all transfers · persist but flag · don't persist plaintext | **Persist, but be honest + tight:** for an **encrypted** transfer the persisted parts are ciphertext (safe at rest). For a **plaintext** transfer they contain file data — a real shift from in-memory-only. Mitigate: clear on success, expire in 24 h, keep one slot, and **only persist above a frame threshold** (D6) so tiny transfers never hit disk. Surface it in the UX copy. **Your call: is on-disk plaintext-partial acceptable given those mitigations?** |
| **D6** | When to persist | Only when `seqLen > ~40` frames (large enough that resume helps) · always | **Above ~40 frames** — small transfers finish in seconds; not persisting them avoids the disk write entirely and shrinks the D5 surface. |

## 3. Design

- **Storage module** `web/src/receiver/resume.ts` (thin IndexedDB wrapper): `save(partial)`, `load()`, `clear()`. `partial = { parts: string[], percent: number, savedAt: number, frames: number }`. Single record (fixed key). DOM-independent enough to unit-test the shape (IndexedDB mocked or via a small fake).
- **Capture:** during scanning, each accepted QR string is added to an in-memory `Set`; when `seqLen > threshold`, persist the set (debounced, e.g. every ~1 s or every N new parts) with the current percent.
- **Resume offer:** on receiver open, if a non-expired partial exists → a new **Ready-with-resume** screen: *"Resume last transfer — X% collected"* [Resume] and [Start fresh]. Resume → replay stored parts into a fresh `Assembler`, then start the camera (continues the same session; bc-ur dedupes and rejects any foreign-session part). Start fresh → `clear()` + normal Ready.
- **Completion/failure:** on verified success → `clear()`. On explicit Start over → `clear()`.
- **State model (§14) additions (feedback to architecture):** a `Resumable` entry state and a `Resuming` transient (replaying persisted parts). Recorded as architecture feedback → an update note when this ships.

## 4. Tasks (ordered)

1. **T1 — storage module + tests:** `resume.ts` (IndexedDB save/load/clear, expiry) + unit tests (round-trip a partial, expiry drops stale, clear empties). Confirm the IndexedDB approach works headless (fake-indexeddb in tests).
2. **T2 — capture + persist:** thread a part `Set` through the scan loop; debounced `save()` above the frame threshold (D6).
3. **T3 — resume UX:** the Ready-with-resume screen (Resume / Start fresh); replay-then-scan on Resume; a *Resuming…* note; clear on success/Start-over.
4. **T4 — privacy copy:** one honest line where relevant (e.g. Start-fresh clears the saved partial; encrypted partials are ciphertext, plaintext ones are file data kept briefly on this device).
5. **T5 — tests + browser:** unit (storage) + browser drive (partial scan → reload → Resume → completes; Start fresh → 0%).
6. **T6 — docs:** receiver architecture note + `blink-drop-ux-design` state addition (Resumable/Resuming) + CHANGELOG; bump to v1.1.0. No security-review re-run needed (no wire change), but §17 gains a **data-at-rest** note (D5).
7. **T7 — on-device** (user): background the receiver mid-scan, reopen, Resume.

## 5. Out of scope
- Any protocol/wire/encryption change. Multi-file. Cross-device resume. Persisting the *sender* side (it has nothing to resume — it just loops).
- Resuming across a *different* transfer (single slot; a new transfer offered Start-fresh replaces it).

## 6. Release checklist (v1.1.0)
1. Branch `feat/v1.1-resume` → T1–T6 → PR (CI green) → merge.
2. Regression: biome, tsc, tests (+ storage tests), PWA + single-file sender builds.
3. Bump `web` → 1.0.0? — **see note.** If v1.0.0 (feature-complete milestone) is cut first, this is 1.1.0; otherwise this itself could be the 1.0.0 line. Decide at release.
4. Tag + GitHub release; Pages redeploys.
5. T7 — user confirms resume on the iPhone.

> **Aside (not this plan):** the top-level `README.md` is stale — it still says "native iOS receiver" and predates encryption/Argon2/drag-drop. Worth a quick refresh (and a possible **v1.0.0** milestone) independent of this feature.
