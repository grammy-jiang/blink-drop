# Blink-Drop — Implementation Plan (v0.5: Sender polish → v1 feature-complete)

| | |
|---|---|
| **Status** | Draft v0.1 — **for review before implementation** |
| **Date** | 2026-07-07 |
| **Target release** | **v0.5.0** (adds drag-and-drop → minor bump; declares the blueprint v1 In-list complete) |
| **Scope** | Close the last unbuilt items on the blueprint's §9 **In**-list for the sender: a **soft-ceiling warning above ~2 MB**, **drag-and-drop** file input, and an ETA/guidance copy pass. Sender-only; no protocol/wire change; encryption untouched. |
| **Sources** | `00-blueprint.md` §9 In-list (soft warning >2 MB; drag-and-drop; time estimate; cycle indicator) + §11 S6; `04-roadmap.md` M4; `docs/web/architecture.md`. |

> **Plan for review.** §2 lists the choices (thresholds, drag-drop surface, copy) with recommendations. Confirm/adjust §2, then I implement.

---

## 1. Goal

The sender already has file-pick, rate/density controls, a per-pass time estimate, and a cycle/frame indicator. Three blueprint §9 In-list items remain:

1. **Soft-ceiling warning** — above ~2 MB, tell the user honestly this will be slow (and near the practical ceiling) *without blocking* — the transfer still runs.
2. **Drag-and-drop** — drop a file onto the page, not only click-to-pick.
3. **Copy/guidance pass** — tighten the ETA line, add a one-line "how to use", confirm the cycle indicator reads clearly.

Landing these lets us declare the product **v1 feature-complete** (every blueprint In-list item shipped).

## 2. Decisions for review

| # | Decision | Options | Recommendation |
|---|----------|---------|----------------|
| **D1** | Soft threshold | 2 MB (blueprint wording) · a computed "> ~N seconds" threshold | **2 MB**, matching the blueprint. Show the estimate regardless; the *warning* styling appears above 2 MB. |
| **D2** | Behaviour at the soft ceiling | Warn but proceed · warn + require a confirm click | **Warn but proceed** — the blueprint says *soft* warning; never block. A second, stronger warning near the receiver's hard cap (8 MB, `HARD_MAX_DECOMPRESSED_BYTES`) noting the receiver will refuse it. |
| **D3** | Drag-and-drop surface | Whole page is a drop target · a dedicated dashed drop zone around the file input | **Dedicated drop zone** (dashed box wrapping the file input) — clearer affordance, avoids accidental whole-page drops; keeps click-to-pick too. |
| **D4** | Extract size logic for testing | Pure helper `describeSize(bytes)` → `{ warn, hard, etaHint }` · inline in the handler | **Pure helper** — unit-testable without the DOM (one small test), matches the isolable-core habit. |
| **D5** | Version | v0.5.0 (drag-drop = new capability) · v0.4.1 (polish only) | **v0.5.0** — drag-and-drop is a new input capability; also the natural "v1 feature-complete" marker. |

## 3. Tasks (ordered)

### T1 — Soft-ceiling warning
- **Goal:** on file select, if `size > 2 MB` show a warning line (est. time + "keep both screens steady; large files are slow over QR"); if `size > 8 MB` (receiver hard cap) a stronger warning that the receiver will refuse it. Transfer still proceeds (D2).
- **Files:** `web/src/ui/sender.ts` (a pure `describeSize` helper + wire into the file handler), `web/index.html` (a `#sizewarn` line + CSS).
- **Acceptance:** ≤2 MB → no warning; 2–8 MB → soft warning + estimate; >8 MB → strong warning naming the receiver cap. Never blocks.
- **Verify:** unit test for `describeSize` (boundaries 2 MB, 8 MB); browser — pick small/medium/large, observe the line.

### T2 — Drag-and-drop
- **Goal:** a dashed drop zone around the file input; dropping a file runs the same path as picking one; keep click-to-pick.
- **Files:** `web/index.html` (drop-zone markup + CSS incl. a drag-over state), `web/src/ui/sender.ts` (`dragover`/`drop` handlers → reuse the file handler; `preventDefault` so the browser doesn't navigate).
- **Acceptance:** dropping a file starts the same flow (incl. passphrase/argon if set); drag-over shows a highlight; click-to-pick still works.
- **Verify:** browser — synthesize a drop (DataTransfer) and confirm the flow starts.

### T3 — Copy / guidance pass
- **Goal:** tighten the ETA line, add a one-line "point the phone receiver at the animation; keep it playing until Verified", confirm the cycle/frame indicator wording. No behaviour change.
- **Files:** `web/src/ui/sender.ts`, `web/index.html`.
- **Acceptance:** copy is honest (no fake delivery %; time/cycles only, per the locked UX rules) and clear; no functional change.
- **Verify:** read-through + browser glance.

## 4. Out of scope
- Any protocol/wire/encryption change. Rate/density controls, time estimate, cycle indicator (already built) — only copy is touched.
- Receiver changes. On-device throughput tuning (roadmap M3, needs a device).
- Multi-file (separate track).

## 5. Release checklist (v0.5.0)
1. Branch `feat/v0.5-sender-polish` → T1–T3 → PR (CI green) → merge.
2. Regression: biome, tsc, tests (+ the `describeSize` test), PWA + single-file sender builds.
3. Bump `web` 0.4.0 → 0.5.0 (+ lockfile); CHANGELOG v0.5.0; note **v1 feature-complete** (all blueprint §9 In-list items shipped).
4. Tag `v0.5.0` + GitHub release; Pages redeploys.
5. Browser-verify the three items in Chrome; on-device confirmation remains the standing T8.
