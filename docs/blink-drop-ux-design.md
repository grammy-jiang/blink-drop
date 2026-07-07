# Blink-Drop — UX Design

> **⚠️ Pre-pivot surface note (2026-07-07).** The receiver shipped as an **installable PWA**, not a native iOS app. Read every "iOS Receiver / SwiftUI / AVFoundation / ShareLink / .fileExporter / Xcode" reference below as its **PWA equivalent**: **getUserMedia + jsQR** over HTTPS, **Web Share API + download fallback**, install via the browser. The **state model, journeys, honest-progress, verified-gate, stall guidance, and result card are unchanged** — only the surface and share/export APIs differ. Pivot delta: [`blink-drop-architecture-update.md`](blink-drop-architecture-update.md).

## Contents

1. [Generation Metadata](#1-generation-metadata)
2. [Source Architecture Interpretation](#2-source-architecture-interpretation)
3. [Source Blueprint Interpretation](#3-source-blueprint-interpretation)
4. [UX Goals and Non-Goals](#4-ux-goals-and-non-goals)
5. [Skill Operator UX](#5-skill-operator-ux)
6. [Target Software UX](#6-target-software-ux)
7. [Users, Roles, and Jobs-to-Be-Done](#7-users-roles-and-jobs-to-be-done)
8. [UX Decision Summary](#8-ux-decision-summary)
9. [UX Assumptions](#9-ux-assumptions)
10. [User Stories](#10-user-stories)
11. [Core User Journeys](#11-core-user-journeys)
12. [Surface-Specific UX](#12-surface-specific-ux)
13. [Human-in-the-Loop UX](#13-human-in-the-loop-ux)
14. [Trust, Control, and Transparency UX](#14-trust-control-and-transparency-ux)
15. [Error, Empty, Loading, Degraded, and Recovery States](#15-error-empty-loading-degraded-and-recovery-states)
16. [Notifications and Feedback](#16-notifications-and-feedback)
17. [Accessibility and Internationalization](#17-accessibility-and-internationalization)
18. [UX Observability](#18-ux-observability)
19. [Acceptance Criteria](#19-acceptance-criteria)
20. [E2E Scenario Seeds](#20-e2e-scenario-seeds)
21. [Architecture Feedback / Required Architecture Updates](#21-architecture-feedback--required-architecture-updates)
22. [Handoff Notes for Implementation Planning](#22-handoff-notes-for-implementation-planning)
- [Appendix A. UX Quality-Gate Self-Check](#appendix-a-ux-quality-gate-self-check)

## Update History

| Date | Source Architecture | UX Version | Change Type | Affected Sections | Notes |
|------|---------------------|------------|-------------|-------------------|-------|
| 2026-07-07 | `blink-drop-architecture-design.md` v0.1 | v0.1 | Initial UX design | all | Receiver-weighted; 3 high-impact UX decisions confirmed by user (solo-primary, result-card-first, light active guidance) |

---

## 1. Generation Metadata

| Field | Value |
|-------|-------|
| project_name | Blink-Drop |
| source_architecture | `docs/blink-drop-architecture-design.md` v0.1 |
| source_blueprint | `docs/00-blueprint.md` v0.4 |
| source_protocol (constraint) | `docs/01-protocol.md` v0.1 |
| topic_slug | `blink-drop` |
| mode | hybrid |
| clarifications asked | 3 (all answered 2026-07-07 — see §8) |
| assumptions recorded | 8 (see §9) |
| user stories | 10 (§10) |
| E2E seeds | 6 (§20) |
| skill_version | ux-design; version `unknown` |

---

## 2. Source Architecture Interpretation

The architecture (`blink-drop-architecture-design.md` v0.1) was parsed; all UX-relevant sections are present (none missing/invented):

- **Surfaces (§9, §23.1):** exactly two — Web Sender (desktop browser SPA) and iOS Receiver (SwiftUI, camera-first). No CLI/MCP/API/agent.
- **State model (§14):** canonical lifecycle states for both sides (sender Idle→…→Stopped; receiver Ready→…→Complete/Failed) plus operational overlays `stalled` / `adjusting`. All UX states in this document resolve here.
- **Interface contracts (§12):** wire is fixed by the protocol; capture (§12.4), presentation controls (§12.5), file export (§12.6), file input (§12.7) are the UX-facing contracts.
- **Security/egress (§17):** `local_only`; **no confidentiality in v1 (DEC-1)** — UX must not imply privacy; SHA-256 end-gate (SG-1) governs when "verified" may be shown.
- **Failure/recovery (§18):** frame loss (absorbed), stall, digest mismatch, decompression overflow, permission denied, capture-throughput fallback, competing session, backgrounding, oversized file.
- **Observability (§16):** local only; user-facing progress/rate; diagnostic events map here.
- **Experience Architecture (§23):** honest progress, verified-only, loud fail, human-ACK cues — carried forward unchanged.
- **UX handoff (§23.8):** detail camera-framing guidance, progress/stall thresholds, verify moments, share/save; weight ~80% receiver. This document delivers exactly that.

No architecture section was missing. Nothing below re-decides architecture, the state model, contracts, or the tech stack.

---

## 3. Source Blueprint Interpretation

From the blueprint's **Product Experience Direction** (preserved, not changed):

- **Experience thesis:** *Point your phone at a screen; the file arrives, verified — no setup, no pairing, no accounts.*
- **JTBD:** move a small file from a computer to a phone when no network/cable/cloud/pairing is available.
- **Interaction modes:** web sender (drop → plan → play → adjust) and iOS receiver (open → scan → progress → verified → share). No other surfaces.
- **Trust/control/transparency:** honest progress; verified only after SHA-256; no privacy claims v1; user keeps control (adjust/abort/choose target).
- **Human-in-the-loop:** the human is the acknowledgment channel (one-way channel) — cues "got it / it's stuck / start over".
- **Failure/recovery expectations:** stalls get concrete guidance; verify-fail is loud and withholds the file.
- **Recommended Next Stages:** ux-design (this) → implementation-plan.

---

## 4. UX Goals and Non-Goals

**Goals.**
- **Zero ceremony** — the receiver is collecting within seconds of opening; the sender is one drop away from playing.
- **Honesty by construction** — never show a fabricated delivery %, never show "verified" before the SHA-256 gate.
- **Recover from optics** — the receiver's hardest job is aiming at a moving animation; make stalls self-correcting.
- **Trust the terminal moment** — the verified result is a clear, controllable moment (Share / Save / Discard).

**Non-Goals (this stage).**
- No pixel-level layout, visual design, CSS, colour systems, or final copy (illustrative wording only).
- No confidentiality/encryption UX in v1 (DEC-1; a Future story only).
- No localization (blueprint non-goal) — English v1.
- No CLI/MCP/API/agent UX (no such surface).
- No re-decision of architecture, state model, contracts, or tech stack.

---

## 5. Skill Operator UX

**Minimal by design.** Blink-Drop has no "skill operator" surface in the product sense — there is no workflow tool an operator drives. The only operator is **the developer building and running the app**, whose workflow is already specified outside UX:

- Web dev loop: Vite dev server; `docs/web/architecture.md`.
- iOS dev loop: Xcode build + free-Apple-ID sideload + the ~weekly re-sign; `docs/ios/primer.md`.
- Test/tuning: shared test vectors in CI; the sweep harness on-device (`04-roadmap.md` M3).

No operator-facing UX stories are required. All experience weight is in §6 (Target Software UX).

---

## 6. Target Software UX

Two surfaces. The **iOS Receiver carries ~80% of the design weight** (the failure-prone surface); the **Web Sender is intentionally lean**.

### 6.1 Web Sender (desktop browser) — lean

A single-screen flow with no navigation:
1. **Drop zone** (empty state) — drag a file or click to pick; a one-line note that it works offline and nothing is uploaded.
2. **Plan** (Loaded) — filename, size (and compressed size), frame count, **estimated transfer time**, shown *before* playing.
3. **Prepared** — brief "preparing frames…" if perceptible.
4. **Playing** — the animation is the dominant element; a **loop-cycle counter** and **elapsed time**; two controls only: **rate** and **scale**; a one-line self-cue: *"Keep playing until your phone shows Verified."*
5. **Stopped** — summary + "send another".

The sender never claims delivery — it shows time/cycles only (it cannot know what the phone received).

### 6.2 iOS Receiver (phone, camera-first) — the weighted surface

Camera-first, single primary screen with light guidance and clear terminal states:
1. **Ready** — opens straight into the live camera with a **target frame** and the hint *"Point at the animation."* First run shows a **permission priming** explainer *before* the OS camera prompt.
2. **Locked** — on the first valid frame: show **filename-pending**, **byte size**, and an **ETA** immediately (size/denominator come from any part; the name resolves at reassembly — protocol §4).
3. **Collecting** — a **progress ring** showing a *real* fraction of a known total, plus a live collection-rate; the target frame stays for aiming.
4. **Stalled overlay** (operational) — when progress stops, **escalating generic guidance** appears (see §15): "hold steady" → "move closer or reduce glare" → "ask the sender to slow down or enlarge". The guidance is *generic*, not sensor-diagnosed (the app cannot tell glare from distance).
5. **Reconstructing / Verifying** — brief "assembling…" / "verifying…".
6. **Complete → Result card** (confirmed decision): a card with **name, size, type, and a verified ✓ badge**, and three actions — **Share** (iOS share sheet), **Save to Files**, **Discard**. The file is exposed only here, only after the SHA-256 gate.
7. **Failed** — a **loud** state: the file is **not** available; a plain message ("Couldn't verify the file — nothing was saved"); actions **Keep scanning** / **Restart**. Never "accept anyway".

---

## 7. Users, Roles, and Jobs-to-Be-Done

| Role | Description | JTBD | Priority |
|------|-------------|------|----------|
| **Self-transferrer** (primary) | One person with a computer and their own phone | "Move my small file from this computer to my phone with no network/cable/cloud." | **Primary** (confirmed §8) |
| **Two-person handoff** | Person A at the computer, person B with the phone | "Get this file onto their phone across the room, offline." | Supported fallback |
| **Developer/operator** | Builds & runs the apps | (see §5) | Out of product UX |

Solo-primary shapes the copy: the "cues" become **watch-your-own-phone self-signals** rather than instructions to another person; the sender's self-cue tells the one user when to stop.

---

## 8. UX Decision Summary

| # | Decision | Choice | Provenance | Affects |
|---|----------|--------|------------|---------|
| UXD-1 | Primary user framing | **Solo (one person, two devices)**; two-person supported | user-confirmed 2026-07-07 | copy, cues (§7, §13) |
| UXD-2 | Terminal (Complete) flow | **Result card first** (Share / Save / Discard) | user-confirmed 2026-07-07 | §6.2, US-R6 |
| UXD-3 | Camera-framing help | **Light active guidance** (target frame + escalating stall hints) | user-confirmed 2026-07-07 | §6.2, §15, US-R3/R5 |
| UXD-4 | Progress semantics | Receiver: real fraction of known total; Sender: time/cycles only | architecture §23.4 (preserved) | §14, US-R4 |
| UXD-5 | Verified gating | "Verified" shown only after SHA-256 (SG-1) | architecture §17.7 (preserved) | US-R6 |
| UXD-6 | Privacy claims | None — UI must not imply confidentiality (DEC-1) | architecture §17.5 (preserved) | §14 |

---

## 9. UX Assumptions

Low-risk, inferred; recorded for review (none blocks the design).

| ID | Assumption | Risk | Revisit |
|----|------------|------|---------|
| UXA-1 | First run shows a camera-permission priming explainer before the OS prompt | low | standard iOS practice |
| UXA-2 | Camera is active while the Scan screen is foregrounded; stops on background/Complete | low | battery/privacy |
| UXA-3 | Stall guidance is generic escalating tips (not per-cause sensor detection) | low | honesty — app can't diagnose glare vs distance |
| UXA-4 | After Share/Save/Discard, the receiver returns to Ready to scan another | low | flow closure |
| UXA-5 | Success = subtle haptic + the verified card; failure = distinct haptic + loud visual | low | §16 |
| UXA-6 | Sender exposes rate + scale as the only controls; fragment size is not user-adjustable | low | protocol §6 / R-ADJUST |
| UXA-7 | MVP-0 UX was minimal/developer-facing; the browser receiver was later **promoted to the shipped PWA receiver** (no longer a throwaway proof) | low | roadmap M0 |
| UXA-8 | Filename shown as "receiving…" until reassembly, then resolves (size/ETA shown from first part) | low | protocol §4 |

---

## 10. User Stories

Format: ID · phase · surface · release-gate · depends-on · story · preconditions · main / alternative / failure-recovery flows · user-visible states (→ §14) · acceptance (→ §19) · E2E (→ §20).

### Sender

**US-S1 — See the transfer plan before playing**
- Phase: **MVP-0** · Surface: Web Sender · Release-gate: **yes** · Depends-on: —
- *As a* self-transferrer, *I want* to see size, frame count, and estimated time before I start, *so that* I know what I'm committing to.
- Preconditions: page open (Idle).
- Main: drop file → Loaded shows name, size, compressed size, frames, ETA.
- Alternative: pick via file dialog.
- Failure/recovery: empty/zero-byte file → inline "choose a non-empty file"; over soft ceiling → warning + honest ETA, user may proceed.
- States: Idle → Loaded. Acceptance: AC-S1. E2E: E2E-1, E2E-6.

**US-S2 — Play the looping stream and know when to stop**
- Phase: **MVP-1** · Surface: Web Sender · Release-gate: yes · Depends-on: US-S1
- *As a* self-transferrer, *I want* the animation to loop with a visible cycle count and a clear "stop when your phone says Verified" cue, *so that* I know it's working and when I'm done.
- Preconditions: Loaded.
- Main: Prepared (frames generated) → Playing (animation + cycle counter + elapsed + self-cue).
- Failure/recovery: none (looping is the steady state); user Stops manually.
- States: Loaded → Prepared → Playing → Stopped. Acceptance: AC-S2. E2E: E2E-2.

**US-S3 — Slow down / enlarge without losing progress**
- Phase: **MVP-1** · Surface: Web Sender · Release-gate: yes · Depends-on: US-S2
- *As a* self-transferrer whose phone is struggling, *I want* to lower the rate or increase the on-screen size mid-play, *so that* the phone can catch up — without restarting the transfer.
- Preconditions: Playing.
- Main: adjust rate/scale → animation retimes/redraws; the receiver's collected progress is preserved (R-ADJUST).
- Failure/recovery: n/a. States: Playing ⇄ Paused/adjusting. Acceptance: AC-S3 (blueprint S8). E2E: E2E-3.

**US-S4 — Sender runs offline from a saved file**
- Phase: **MVP-1** · Surface: Web Sender · Release-gate: yes · Depends-on: —
- *As a* user on an air-gapped machine, *I want* to open the saved single-file page with no network and no login, *so that* I can send from a disconnected computer.
- Main: open the saved HTML offline → full function; no upload, no account.
- Acceptance: AC-S4 (blueprint S7). E2E: E2E-6.

### Receiver (weighted)

**US-R1 — Open straight into scanning**
- Phase: **MVP-1** · Surface: iOS Receiver · Release-gate: yes · Depends-on: US-R2
- *As a* self-transferrer, *I want* the app to open directly to the camera and start collecting with no setup, *so that* there's zero ceremony.
- Main: launch → Ready (live camera + target frame + "point at the animation").
- States: Ready. Acceptance: AC-R1 (blueprint S5). E2E: E2E-2.

**US-R2 — Grant camera permission with context**
- Phase: **MVP-1** · Surface: iOS Receiver · Release-gate: yes · Depends-on: —
- *As a* first-time user, *I want* a short explainer before the OS camera prompt, *so that* I understand why and grant it confidently.
- Main: first run → priming explainer → OS prompt → granted → Ready.
- Failure/recovery: denied → blocking screen explaining the app needs the camera + a deep link to Settings (§15).
- States: Ready (blocked variant). Acceptance: AC-R2. E2E: E2E-5.

**US-R3 — Aim with light guidance**
- Phase: **MVP-1** · Surface: iOS Receiver · Release-gate: yes · Depends-on: US-R1
- *As a* user pointing at a moving animation, *I want* a target frame and hints, *so that* I can line up the code and start collecting quickly.
- Main: Ready → target frame guides aim → first valid frame → Locked.
- Failure/recovery: if no lock within a few seconds, show "fill the frame with the animation".
- States: Ready → Locked. Acceptance: AC-R3. E2E: E2E-2.

**US-R4 — See honest progress from the first frame**
- Phase: **MVP-1** · Surface: iOS Receiver · Release-gate: **yes** · Depends-on: US-R3
- *As a* user, *I want* a real progress fraction (not a fake %) and an ETA from the first frame, *so that* I trust what I'm seeing.
- Main: Locked shows byte size + ETA immediately; Collecting shows collected/needed + ring + live rate; filename resolves at reassembly (UXA-8).
- States: Locked → Collecting. Acceptance: AC-R4 (blueprint S4 join, honest-progress). E2E: E2E-2.

**US-R5 — Recover from a stall**
- Phase: **MVP-1** · Surface: iOS Receiver · Release-gate: yes · Depends-on: US-R4
- *As a* user whose progress stalled, *I want* escalating, actionable guidance, *so that* I can fix the optics — including asking the sender to slow down/enlarge.
- Main: no new distinct part for N s → `stalled` overlay → escalating tips (§15); progress resumes when captured.
- Failure/recovery: persistent stall → suggest the sender lower rate / enlarge (ties US-S3).
- States: Collecting + `stalled`. Acceptance: AC-R5 (blueprint S3). E2E: E2E-3.

**US-R6 — Get the verified file and choose what to do**
- Phase: **MVP-1** · Surface: iOS Receiver · Release-gate: **yes** · Depends-on: US-R4
- *As a* user, *I want* the reconstructed file presented as a verified card with Share / Save / Discard, *so that* I control where it goes and can reject a wrong file.
- Preconditions: enough parts collected.
- Main: Reconstructing → Verifying → **SHA-256 pass** → Complete: result card (name, size, type, verified ✓) → Share (share sheet) / Save to Files / Discard → return to Ready (UXA-4).
- Failure/recovery: user cancels share → stay on card.
- States: Reconstructing → Verifying → Complete. Acceptance: AC-R6 (blueprint S2). E2E: E2E-2.

**US-R7 — Loud, safe failure on verify mismatch**
- Phase: **MVP-1** · Surface: iOS Receiver · Release-gate: **yes** · Depends-on: US-R6
- *As a* user, *I want* a clear failure with the file withheld when verification fails, *so that* I never receive a silently corrupted file.
- Main: Verifying → **SHA-256 mismatch** or unrecoverable → Failed: loud message, file NOT available, actions Keep scanning / Restart.
- States: Verifying → Failed → (Collecting | Ready). Acceptance: AC-R7 (blueprint S2). E2E: E2E-4.

**US-R8 — Don't mix up two senders**
- Phase: **MVP-1** · Surface: iOS Receiver · Release-gate: yes · Depends-on: US-R4
- *As a* user with two animations in view, *I want* the app to stay locked to the one it started, *so that* frames don't get mixed.
- Main: locked to first `checksum`; foreign-session frames ignored; switching is an explicit action.
- States: Collecting (session-locked). Acceptance: AC-R8 (blueprint S9). E2E: E2E-4 (variant).

**US-R10 — [MVP-0] Prove the protocol end-to-end (developer-facing)**
- Phase: **MVP-0** · Surface: throwaway browser receiver · Release-gate: no (dev artifact) · Depends-on: US-S1
- *As the* developer, *I want* a browser page that captures the sender's animation, reconstructs, and verifies a real file, *so that* the protocol is proven before any native work.
- Main: web sender plays → browser receiver (getUserMedia + bc-ur, reusing `web/src/core`) collects → verifies SHA-256 → shows pass/fail. Minimal UI.
- States: mirrors receiver lifecycle at a bare level. Acceptance: AC-R10. E2E: E2E-1 (core), E2E-2 (optical).

*(Future) US-F1 — Encrypt/decrypt with a passphrase (v1.1, DEC-1). Not in v1; recorded so the terminal and plan flows leave room for a passphrase step between file and gzip.*

---

## 11. Core User Journeys

**J1 — Solo happy path (primary).** One person: drop file on laptop → see plan → play → pick up phone → open app (already scanning) → aim → watch honest progress → verified card → Save to Files / Share → glance back at laptop, Stop. *States:* sender Idle→…→Playing→Stopped; receiver Ready→…→Complete.

**J2 — Struggling optics → recover.** Collecting stalls → guidance escalates → user moves closer / lowers sender rate (US-S3) → progress resumes → Complete. Demonstrates R-ADJUST + honest recovery.

**J3 — Verify failure → safe.** Rare: reconstruction fails SHA-256 → Failed (loud, file withheld) → Keep scanning → succeeds, or Restart. Demonstrates the never-silent-corruption rule.

**J4 — [MVP-0] Protocol proof.** Web sender ↔ throwaway browser receiver on real screens/cameras; validates fountain/framing/verify before Xcode.

---

## 12. Surface-Specific UX

Only the two surfaces the architecture uses. (No CLI/TUI/AI-Skill/MCP/API — omitted deliberately.)

### 12.1 Web GUI (Sender)
- Single screen, no routing; states drive the view (§14 sender states).
- Controls: **rate** and **scale** only (protocol §6 / R-ADJUST); fragment size is not exposed.
- Progress semantics: **time + loop cycles only** — no delivery %.
- Offline-first: works from the saved single-file page with no network/login (US-S4).
- Illustrative only (not final layout/copy): a large canvas for the animation; a compact plan/controls panel beside it.

### 12.2 iOS App (Receiver)
- Camera-first single primary screen; result and failure are distinct states, not separate apps.
- **Light active guidance:** a target frame; escalating generic hints on `stalled` (§15). No sensor-based per-cause diagnosis (UXA-3).
- **Progress:** ring + collected/needed + live rate; ETA from observed rate.
- **Terminal:** result card (name/size/type/verified ✓) → Share / Save to Files / Discard (UXD-2).
- **Share:** iOS `ShareLink`; **Save:** `.fileExporter` (architecture §12.6).
- Illustrative only: viewfinder fills the screen; progress and hints overlay the bottom third; the result card slides up on Complete.

---

## 13. Human-in-the-Loop UX

The optical channel has no machine acknowledgment, so a **human closes the loop**. This is the product's "review/confirmation" flow. Solo-primary (UXD-1) shapes it:

| Cue | Solo (primary) | Two-person | Maps to control (§12) | State transition (§14) |
|-----|----------------|------------|-----------------------|------------------------|
| **"Got it"** | User sees the phone hit **Verified**, then Stops the sender themselves | Receiver-user says "got it"; sender-user Stops | Sender **Stop** | Playing → Stopped |
| **"It's stuck"** | User sees the stall overlay and adjusts the sender (or moves the phone) | Receiver-user asks sender to slow down/enlarge | Sender **rate/scale** (US-S3) | Playing ⇄ adjusting; Collecting continues |
| **"Start over"** | User Restarts on the phone and/or reloads the sender | Either person aborts | Receiver **Restart**; sender reload | → Ready / Idle |

Design implication: the **sender's self-cue** ("keep playing until your phone shows Verified") is the solo user's substitute for a spoken "got it". No machine back-channel is added (one-way channel preserved).

---

## 14. Trust, Control, and Transparency UX

- **Verified means verified.** The verified ✓ badge and the file itself appear **only after the SHA-256 gate** (SG-1). "All frames seen" is never shown as done.
- **Honest progress.** Receiver shows a real fraction of a known total; sender shows time/cycles and **must never fabricate a delivery %** (it cannot know).
- **No false privacy (DEC-1).** The UI must **not** imply the transfer is confidential — no lock icons, no "secure"/"encrypted" language. If any reassurance is shown, it is about *integrity* (verified), not *secrecy*. (A short, honest note that anyone who can see the screen can read the data is acceptable; a "secure" claim is not.)
- **Control.** The user can adjust (rate/scale), abort at any time (no residue), choose the share target, and **Discard** a verified-but-unwanted file. Failure never coerces acceptance.

---

## 15. Error, Empty, Loading, Degraded, and Recovery States

| Kind | Where | UX |
|------|-------|----|
| **Empty** | Sender Idle | Drop-zone hint + offline/no-upload note |
| **Empty** | Receiver Ready | Live camera + target frame + "point at the animation" |
| **Loading** | Sender Prepared | "Preparing frames…" (only if perceptible) |
| **Loading** | Receiver Reconstructing/Verifying | brief "assembling…" / "verifying…" |
| **Degraded (stall)** | Receiver Collecting + `stalled` | **Escalating generic guidance:** (1) "Hold steady" → (2) "Move closer or reduce glare" → (3) "Ask the sender to slow down or make it bigger." Generic, not sensor-diagnosed (UXA-3). |
| **Degraded (low light / far)** | Receiver | folded into the escalating guidance above |
| **Error — verify fail** | Receiver Failed | **Loud**, file withheld: "Couldn't verify the file — nothing was saved." Actions: Keep scanning / Restart. Never "accept anyway". |
| **Error — decompression overflow** | Receiver | treated as verify failure (Failed); same UX |
| **Error — camera permission denied** | Receiver | Blocking screen: why the camera is needed + "Open Settings" deep link |
| **Error — no camera / unsupported** | Receiver | Clear "this device can't scan" message (e.g. Simulator) |
| **Recovery — mid-loop join / backgrounded** | Receiver | Rescanning is cheap (R-SUBSET); no resume in v1 — restarting collection is fast and framed as normal |
| **Warning — oversized file** | Sender Loaded | Soft warning + honest ETA; user may proceed |
| **Benign — share cancelled** | Receiver Complete | Stay on the result card |

---

## 16. Notifications and Feedback

- **No push notifications** — offline, single device in use; all feedback is in-app.
- **Progress feedback:** receiver ring + collected/needed + live rate; sender cycle count + elapsed + ETA.
- **Success:** subtle haptic + the verified result card (UXA-5).
- **Failure:** distinct (heavier) haptic + the loud Failed state.
- **Stall:** the escalating overlay (§15); optionally a light haptic on first stall.
- **No sound by default** (respect silent contexts); haptics + visuals carry the signal.

---

## 17. Accessibility and Internationalization

- **i18n:** English only in v1 (blueprint non-goal). Keep copy externalizable so localization is a later addition, but do not build locale switching now.
- **VoiceOver / screen reader:** every state and action has a text label (Ready, Locked, Collecting NN%, Verifying, Verified, Failed; Share/Save/Discard/Keep-scanning/Restart). Progress is announced as a fraction, not only a visual ring.
- **Don't rely on colour alone:** verified vs failed use an **icon + text**, not just green/red.
- **Dynamic Type / scaling:** result card and guidance text scale.
- **Reduced motion:** the receiver's non-essential UI animations respect Reduce Motion. **Caveat:** the *sender's* QR animation is functionally essential (it is the data channel) and cannot be disabled — note this so it is not mistaken for a motion-accessibility violation.
- **Contrast/tap targets:** guidance and actions meet standard contrast and target-size expectations (verified at implementation/visual stage).

---

## 18. UX Observability

Local only (architecture §16 — no remote analytics; offline).

| User-visible signal | Backed by diagnostic event (§16 arch) |
|---------------------|----------------------------------------|
| Locked (size/ETA appear) | `session_locked` |
| Collecting progress ticks | `part_received` |
| "Assembling…" | `message_reconstructed` |
| Verified badge | `verify_pass` |
| Failed state | `verify_fail` |
| Share invoked | `share_invoked` |
| Stall overlay | `stalled` flag (§14.3 arch) |

These support debugging and the sweep harness locally; none is transmitted.

---

## 19. Acceptance Criteria

| ID | Criterion | Ties |
|----|-----------|------|
| AC-S1 | Loaded shows name, size, compressed size, frame count, and ETA before any frame plays; empty file blocked; oversized warns | US-S1 |
| AC-S2 | Playing shows a live loop-cycle counter + elapsed; a visible self-cue to stop when the phone shows Verified; no delivery % anywhere | US-S2, UXD-4 |
| AC-S3 | Changing rate/scale mid-play does not reset the receiver's collected progress | US-S3 / blueprint **S8** |
| AC-S4 | The saved single-file page runs fully offline with no network/login | US-S4 / blueprint **S7** |
| AC-R1 | App open → actively collecting in < 10 s with no configuration | US-R1 / blueprint **S5** |
| AC-R2 | First run primes before the OS camera prompt; denial yields a blocking explainer with a Settings link | US-R2 |
| AC-R3 | A target frame is shown; a lock is achievable by filling the frame with the animation | US-R3 |
| AC-R4 | Byte size + ETA appear from the first captured part; progress is a real fraction of a known total (never a fabricated %); mid-loop join adds no full-cycle penalty | US-R4 / blueprint **S4** |
| AC-R5 | On stall, escalating generic guidance appears; collecting resumes without reset after correction | US-R5 / blueprint **S3** |
| AC-R6 | The file and verified ✓ badge appear only after SHA-256 passes; result card offers Share / Save / Discard | US-R6 / blueprint **S2** |
| AC-R7 | On SHA-256 mismatch/unrecoverable, the file is withheld, the failure is loud, and only Keep-scanning / Restart are offered | US-R7 / blueprint **S2** |
| AC-R8 | With two animations in view, only the locked session's frames are collected | US-R8 / blueprint **S9** |
| AC-R10 | The MVP-0 browser receiver reconstructs and SHA-256-verifies a real file transferred optically from the sender | US-R10 |

---

## 20. E2E Scenario Seeds

Gherkin-style seeds (not executable tests). Each carries a testability metadata block.

**E2E-1 — Core protocol round-trip (CI-suitable happy path)**
```gherkin
Given a known input file and its SHA-256 (a shared test vector)
When web/src/core encodes it to UR parts
And the same core (receiver path) decodes those parts back
Then the reconstructed bytes' SHA-256 equals the original
And no bytes are produced if a part is corrupted so the digest fails
```
- phase: MVP-0 · surface: web core (headless) · release-gate: yes · deterministic: yes · requires real LLM: no · **CI suitable: yes** · fixtures: `shared/test-vectors` (framing + roundtrip) · must mock: nothing (no optics) · arch contracts: §12.2/§12.3 · impl components: `web/src/core`

**E2E-2 — Solo optical happy path (verified + saved)**
```gherkin
Given the web sender is playing a small file's animation
And the iOS receiver app is open on the Scan screen
When the user points the phone at the animation
Then progress climbs as a real fraction and reaches Complete
And the verified badge appears only after SHA-256 passes
And the user can Save the file to Files
```
- phase: MVP-1 · surface: iOS + web · release-gate: yes · deterministic: no (optics) · requires real LLM: no · CI suitable: **no** (needs camera+screen) · fixtures: sample file, physical devices · must mock: none · arch contracts: §12.4/§12.6 · impl components: `Capture`, `Core`, `Views`

**E2E-3 — Stall then adjust, no progress loss**
```gherkin
Given the receiver is Collecting at ~50%
When frames are lost (phone moved) and progress stalls
Then escalating guidance appears
And when the sender lowers the rate mid-play
Then already-collected progress is preserved and collection resumes to Complete
```
- phase: MVP-1 · surface: iOS + web · release-gate: yes · deterministic: no · CI suitable: no (optics) · partial CI: the "no progress loss on rate change" invariant is unit-testable on `Core`/decoder · fixtures: devices · arch contracts: §12.5 · impl components: `Player`, `URAssembler`, `TransferModel`

**E2E-4 — Verify failure withholds the file**
```gherkin
Given a transfer whose reconstructed bytes do not match header.sha256
When the receiver reaches Verifying
Then it enters Failed, no file is exposed, the message is loud
And only Keep-scanning / Restart are offered
```
- phase: MVP-1 · surface: iOS (Core) · release-gate: **yes (SG-1)** · deterministic: yes · CI suitable: **yes** (feed a tampered vector to `Core`, assert no output + Failed) · fixtures: tampered-payload vector · must mock: none · arch contracts: §12.3, §17.7 SG-1 · impl components: `Core`, `TransferModel`

**E2E-5 — Camera permission denied**
```gherkin
Given a first-time user
When they deny the camera permission
Then a blocking explainer with an Open-Settings link is shown
And granting later leads to the Scan screen
```
- phase: MVP-1 · surface: iOS · release-gate: yes · deterministic: yes · CI suitable: partial (UI test w/ permission stub) · fixtures: permission state · must mock: authorization status · arch contracts: §12.4 · impl components: `Capture`, `Views`

**E2E-6 — Sender offline from a saved file**
```gherkin
Given the built single-file blink-drop.html saved to a disconnected machine
When the user opens it in a browser with no network
Then they can load a file, see the plan, and play the animation
And no network request is attempted (CSP connect-src 'none')
```
- phase: MVP-1 · surface: web · release-gate: yes (S7) · deterministic: yes · CI suitable: **yes** (load built artifact, assert function + assert no network via CSP/adapter) · fixtures: built artifact · must mock: none · arch contracts: §17.2 SG-3 · impl components: `web` build

### Testability Summary Table

| Seed | Phase | CI-suitable | Deterministic | Release-gate | Needs devices |
|------|-------|-------------|---------------|--------------|---------------|
| E2E-1 | MVP-0 | ✅ | ✅ | yes | no |
| E2E-2 | MVP-1 | ❌ | no | yes | yes (camera+screen) |
| E2E-3 | MVP-1 | partial | no | yes | yes |
| E2E-4 | MVP-1 | ✅ | ✅ | **yes (SG-1)** | no |
| E2E-5 | MVP-1 | partial | ✅ | yes | no |
| E2E-6 | MVP-1 | ✅ | ✅ | yes (S7) | no |

A CI-suitable MVP-0 core-happy-path seed exists (**E2E-1**), plus CI-suitable release-gate seeds for the two mandatory security behaviours (E2E-4 → SG-1, E2E-6 → SG-3).

---

## 21. Architecture Feedback / Required Architecture Updates

**Verdict: No architecture reconciliation required.** The three confirmed UX decisions fit the existing architecture without new states, operations, or contracts:

| UX decision | Fits existing architecture? | Note |
|-------------|-----------------------------|------|
| Solo-primary framing (UXD-1) | Yes | Architecture §2.2 already allows same-person-two-devices; only copy/emphasis, no structural change |
| Result-card-first (UXD-2) | Yes | Matches §12.6 (ResultView: ShareLink + fileExporter + discard) exactly |
| Light active guidance (UXD-3) | Yes | Uses the existing `stalled` flag (§14.3) + user-facing collection-rate (§16); target frame is pure UI |

**Confirmations (not changes) for the implementation-plan to honor:**
1. The receiver `TransferModel` should expose a **live collection-rate** and a **stalled** signal to the UI (already implied by §14.3 + §16) — light guidance reads these.
2. Stall guidance is **generic escalating tips**, not per-cause detection — the architecture provides no glare/distance sensing and none should be assumed (UXA-3).
3. The verified file must be surfaced **only** via the post-SHA-256 result card (SG-1) — the card UI must not pre-render the file before the gate.

No `architecture --mode reconcile` run is needed. Should implementation surface a genuine gap, route it back via reconcile then.

---

## 22. Handoff Notes for Implementation Planning

- **Weighting:** ~80% of receiver UX effort is the Scan surface (guidance + honest progress + terminal states); the sender is lean (drop → plan → play → 2 controls).
- **Start testable:** **E2E-1** (core round-trip) is the first test to stand up — CI-suitable, deterministic, gates MVP-0. Then the two CI-suitable security gates: **E2E-4** (SG-1 verify-withhold) and **E2E-6** (SG-3 offline/no-egress).
- **Release-gating stories:** US-S1/S3/S4, US-R1/R2/R4/R6/R7 (and their ACs). US-R6/R7 encode the two mandatory security behaviours (verified-only exposure; loud-safe failure).
- **Confirmed decisions to build to:** solo-primary copy + sender self-cue; result-card-first terminal; light active guidance with generic escalating stall tips.
- **Phase split:** MVP-0 = US-S1 + US-R10 + E2E-1/E2E-2 (protocol proof). MVP-1 = the receiver stories **as a PWA** (getUserMedia/jsQR + Web Share) + sender play/adjust — shipped in v0.1.0.
- **Do not add:** confidentiality/privacy UI (DEC-1; a Future story), localization, any second app surface.
- **Next stage:** hand these stories + E2E seeds to the (hand-rolled) implementation-plan; it turns E2E seeds into concrete test tasks and orders the build against `04-roadmap.md`.

---

## Appendix A. UX Quality-Gate Self-Check

| Gate | Status | Note |
|------|--------|------|
| 1. Source architecture consumed | PASS | §2 reflects the architecture; nothing invented |
| 2. Product Experience Direction preserved | PASS | §3 carries blueprint intent unchanged |
| 3. Skill-Operator vs Target-Software UX separated | PASS | §5 (minimal, dev-only) vs §6 (the product); kept distinct |
| 4. User stories structured | PASS | §10: preconditions, main/alt/failure-recovery, states, acceptance |
| 5. Failure/recovery flows defined | PASS | §15 + per-story failure flows; stall, verify-fail, permission |
| 6. Human-review UX where needed | PASS | §13 — the human-ACK loop is the review/confirmation flow |
| 7. E2E seeds generated | PASS | §20, six Gherkin seeds, not executable tests |
| 8. Architecture feedback present | PASS | §21 (mandatory), verdict + confirmations |
| 9. Surface scope controlled | PASS | §12 only the two real surfaces; no CLI/MCP invented |
| 10. No out-of-scope output | PASS | no tests/CSS/final copy/arch re-decisions (illustrative wording flagged) |
| 11. Phase + testability metadata | PASS | every story phase-tagged; every seed has a metadata block; Testability Summary Table present |
| CI-suitable MVP-0 core happy path | PASS | E2E-1 |
| MVP-0 vs MVP-1 distinguishable | PASS | §10 tags + §22 phase split |

No FAIL rows. One deliberate UX capability constraint recorded (UXA-3: stall guidance is generic, not sensor-diagnosed) so it is not mistaken for a gap.
