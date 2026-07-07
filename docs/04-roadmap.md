# Blink-Drop — Roadmap

> **⚠️ Superseded (2026-07-07).** This roadmap predates the PWA pivot. What actually shipped: **M0 proven**, then **MVP-1 = the PWA receiver, released as v0.1.0** — the M0 browser receiver was **promoted to the product**, not discarded. The **native-iOS milestones (M1–M4) below are deferred** (no Mac). Current build plan: [`05-implementation-plan.md`](05-implementation-plan.md); pivot delta: [`blink-drop-architecture-update.md`](blink-drop-architecture-update.md).

| | |
|---|---|
| **Status** | Draft v0.1 |
| **Date** | 2026-07-07 |
| **Depends on** | `00-blueprint.md` (v0.3), `01-protocol.md` (v0.1), `web/architecture.md`, `ios/architecture.md`, `ios/primer.md` |
| **Scope** | The *build* sequence and its acceptance gates. Milestones reference the blueprint's success criteria (S1–S9) so "done" is measurable, not vibes. |

---

## Sequencing principle

Build the **riskiest, most-shared thing first** (the wire protocol, in a throwaway all-browser harness) before paying the cost of a platform the developer is new to (blueprint Risk 6). Native work starts only after the protocol is proven and the experience is designed.

```
 M0 ──► [design gate: ux-design → implementation-plan] ──► M1 ──► M2 ──► M3 ──► M4 ──► v1
 proto        UX + task breakdown                        native   full    tune    ship
 (browser)                                               skeleton  UX
```

A cross-cutting task, **test vectors**, is produced up front because both sides and M0 depend on it.

## Task 0 — Shared test vectors *(precedes M0)*

- Author `shared/test-vectors/` (protocol §10): tier-1 framing (canonical compressed payload → exact `ur:blink-drop/...` parts) and tier-2 round-trip (`input.bin` + `sha256`).
- Cases: 1-fragment text, multi-fragment (real fountain), binary/non-UTF-8, incompressible (`compression=0`).
- **Exit:** vectors committed; a throwaway script generates them reproducibly (pinned fountain seed).
- **Why first:** every later milestone binds to these; they *are* the executable protocol contract.

## M0 — Protocol proof, browser-only (no native)

**Goal:** prove the whole wire path — gzip → dCBOR envelope → UR/MUR fountain → uppercased-alphanumeric QR → screen → camera → reassemble → verify — works end-to-end, **before touching Xcode**. Resolves `OQ-8` (what carries into native).

- **Sender:** the real `web/` sender (`web/architecture.md`), at least to a runnable state.
- **Receiver (throwaway):** a browser page using `getUserMedia` + `@ngraveio/bc-ur` + a JS QR reader (`BarcodeDetector` where available, else a JS decoder), reusing `web/src/core/` **unchanged** (the decode path).
- Run it screen-to-webcam, and screen-to-phone-browser, with a real file.
- **Acceptance:** a real file transfers and SHA-256-verifies (S2 in spirit); mid-loop join works (**S4**); with ~20% frames dropped, time inflates ≤1.5× (**S3**); rough throughput lands in the protocol §6 band.
- **Exit:** protocol validated on real optics; `web/src/core/` proven both directions; ballpark params for the sweep. *(Superseded outcome:* the receiver page was **promoted to the product** — it became the shipped PWA receiver in v0.1.0, not discarded, because the native app was deferred.*)*

## Design gate — ux-design → implementation-plan *(between M0 and M1)*

Native UX should be designed, then task-broken, before it is built:

- **ux-design stage** — turn `ios/architecture.md` §6.2 state surfaces into interaction flows, user stories, acceptance criteria, and E2E scenario seeds: camera-framing guidance, progress-ring behaviour, stall thresholds/copy, verification success/failure moments, share/save flow. Also refines the sender's `Loaded`/estimate and control UX.
- **implementation-plan stage** — break M1/M2 into ordered, testable tasks against that UX and the architecture docs.
- **Exit:** a UX doc + a task plan; M1/M2 scope concretely defined.

## M1 — Native receiver skeleton

**Goal:** first **native** end-to-end transfer onto the iPhone and out through the share sheet — minimal UI, correctness over polish.

- Xcode project per `primer.md`; URKit via SPM; `ios/Core` unit-passing the shared vectors.
- Capture → decode → assemble → verify → `ShareLink`, wired with a bare UI.
- **Acceptance:** a file scanned from the web sender verifies (**S2**) and lands in Files/Messages; app open → collecting in <10 s (**S5**); `ios/Core` green on `shared/test-vectors/`.
- **Exit:** the native path works; the risky platform-learning is behind you.

## M2 — Full receiver UX

**Goal:** implement the designed experience (from the design gate) across all §6.2 states.

- Real progress denominators, stall guidance, loud verification-failure state, result card, save-to-Files.
- Sender: finish `Loaded` estimate, cycle indicator, rate/scale controls (`web/architecture.md`).
- **Acceptance:** 100 KB file ≤30 s ≥95% (**S1**); zero-config start <10 s (**S5**); mid-transfer rate/scale change loses no progress (**S8**); competing session ignored (**S9**).

## M3 — Sweep harness & tuning (L9, OQ-4)

**Goal:** replace seed parameters with measured ones.

- Automated sweep over fragment size × rate on the real device (blueprint L9); records time/success like the prior-art tester.
- **Acceptance:** S1/S3/**S6** measured on-device across the sweep; default fragment size + rate locked from data (closes `OQ-4`).
- **Exit:** protocol §6 seed values replaced with tuned defaults.

## M4 — Sender polish, offline packaging, ship

**Goal:** the v1 the blueprint describes.

- Single-file offline artifact via `vite-plugin-singlefile` + `connect-src 'none'` CSP (**OQ-9**, `web/architecture.md`).
- Soft-ceiling warning, ETA copy, guidance text; docs pass.
- **Acceptance:** sender runs from the saved file on a disconnected machine (**S7**); 2 MB completes within the envelope (**S6**).
- **Exit:** v1 — matches blueprint §9 In-list.

## Milestone → success-criteria coverage

| | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | S9 |
|---|---|---|---|---|---|---|---|---|---|
| M0 | | ✓ | ✓ | ✓ | | | | | |
| M1 | | ✓ | | | ✓ | | | | |
| M2 | ✓ | ✓ | | | ✓ | | | ✓ | ✓ |
| M3 | ✓ | | ✓ | | | ✓ | | | |
| M4 | | | | | | ✓ | ✓ | | |

Every criterion is claimed by at least one milestone; none is left to chance.

## Explicitly deferred (v1.1+ backlog)

Per blueprint §9 / DEC-1: passphrase **encryption** (top item; slots into `core/` between file and gzip, protocol §11), the **native iOS app** (deferred — needs a Mac), resume-across-restart, multi-file, Android receiver. None gates v1. *(Note: PWA packaging is **not** deferred — it shipped in v0.1.0.)*

## Status of gates already passed

- **Security review (DEC-2):** done at the protocol stage — `01-protocol.md` §11. Re-run if the wire format changes.
- **Big lock-in (OQ-1):** decided — adopt UR. Everything above assumes it.
