# Blink-Drop — Implementation Plan (v0.8.0: sender UI simplification)

| | |
|---|---|
| **Status** | Draft v0.1 — user-approved direction (2026-07-07) |
| **Target release** | **v0.8.0** (visible UX shift; no wire/protocol/crypto change) |
| **Scope** | Rework the **sender** (`web/index.html` + `web/src/ui/sender.ts`) for **progressive disclosure** and **minimal copy**: first visit shows only the essentials; encryption, playback tuning, and the phone-link QR appear only on demand. **Receiver unchanged** (already lean). All functionality kept — visibility + wording only. |
| **Why** | First-visit sender shows ~16 elements + wordy copy for a task that is fundamentally "drop a file." |

---

## 1. Locked decisions (user, 2026-07-07)
- **D1 — Idle = Lean.** Drop zone + one short line + two collapsed toggles. (Not ultra-minimal, not current density.)
- **D2 — Sender only.** Receiver already does progressive disclosure (Start button, prompts/cards on demand).
- **D3 — Safety note at send-time.** No capture-warning on the Idle screen; show a compact caution **only when a file is sent without a passphrase**. Invisible for encrypted sends.
- **D4 — Minimal text.** Fewest words possible everywhere; cut every non-essential sentence; move "why/limits" prose into the disclosure it belongs to (or a `title=` tooltip), never on the default screen.
- **D5 — Mechanism.** Native `<details>/<summary>` for disclosures — no JS, keyboard-accessible, no new deps.

## 2. First-visit (Idle) — target

```
              Blink-Drop
        Offline. Nothing uploaded.

   ┌────────────────────────────────┐
   │                                │
   │      Drop a file, or click     │
   │                                │
   └────────────────────────────────┘

   🔒 Add passphrase      📱 Phone link
```

Everything else is hidden until its state/disclosure. All copy on this screen: the title, **one** 3-word line, the drop-zone label, two toggle labels. Nothing more.

## 3. States (sender state model, architecture §14: Idle → Loaded → Playing → Stopped)

| State | Shown | Hidden |
|---|---|---|
| **Idle** (first visit) | title · "Offline. Nothing uploaded." · drop zone · `🔒 Add passphrase` · `📱 Phone link` | everything else |
| **`🔒 Add passphrase`** (open) | passphrase field · strength (one word) · `Stronger key (Argon2id)` checkbox | — |
| **`📱 Phone link`** (open) | receiver-URL QR + "Open on phone" | — |
| **Playing** (after a file) | animation canvas · one-line plan/ETA · Stop · `Adjust ▸` | passphrase/phone toggles collapse away |
| **`Adjust`** (open, while playing) | Speed slider · Size slider | — |
| **Sending unencrypted** | compact caution: "Visible to anyone who can see the screen. 🔒 Add a passphrase?" | (absent when encrypted) |

## 4. Copy rewrite (D4 — before → after)

| Where | Before | After |
|---|---|---|
| Title | `Blink-Drop — Sender` | `Blink-Drop` |
| Intro note | "Pick or drop a file. It is processed on this machine and never uploaded. Point the phone receiver at the animation; keep it playing until the phone shows Verified." | `Offline. Nothing uploaded.` |
| Capture warning | "Anyone who can see this screen can capture the animation. Add a passphrase below…" (always on) | send-time only, unencrypted: `Visible to anyone who can see the screen. 🔒 Add a passphrase?` |
| Drop zone | file input + "or drop file(s) here" | one label: `Drop a file, or click` |
| Passphrase | label "Passphrase (optional)" + placeholder "leave blank = unencrypted" | summary `🔒 Add passphrase`; placeholder `passphrase` |
| Argon2 | "Stronger key derivation (Argon2id) — slightly slower, loads a small module the first time" | `Stronger key (Argon2id)` (+ `title=` for the detail) |
| passnote | "🔒 Encrypted — the receiver must enter this passphrase. Share it separately…" | `Share the passphrase separately.` |
| strength | "Strength: ok — a rough hint; a captured transfer can be attacked offline…" | `Strength: ok` (+ `title=` for the caveat) |
| plan/ETA | "name · N B · N frames · ~Xs per pass — keep playing until the phone shows Verified" | `name · ~Xs / loop` (with a one-time "keep playing until Verified" cue under the canvas) |
| status | "Playing · cycle N · frame N/N" | `Playing · loop N` |
| rate/scale | "Rate … fps" / "Size … px/module" | `Speed` / `Size` |
| receiver QR cap | "Scan to open the receiver on your phone" | `Open on phone` |

Honesty is preserved — the encryption limits and strength caveat still exist, just **inside the encryption disclosure / tooltips**, not on the first screen (consistent with the "honest limits" rule: shown where the decision is made, not as first-visit noise).

## 5. Tasks
1. **T1 — `index.html`:** restructure into the Idle layout + `<details>` panels (encryption, phone-link, adjust); trim all copy per §4; move rate/scale into `Adjust`; drop the two always-on notes. CSS tweaks for the toggle row + disclosures (light/dark already handled).
2. **T2 — `sender.ts`:** show the animation/plan/Stop/Adjust on Loaded; collapse the passphrase/phone toggles once playing; add the **send-time unencrypted caution** (D3); shorten status/plan strings; keep every existing handler (encryption, drag-drop, receiver-QR, sliders) wired — only element ids / visibility change.
3. **T3 — verify in Chrome (local):** first visit shows only the essentials; each disclosure reveals correctly; drop → play works; encrypted send still round-trips; unencrypted send shows the caution; dark mode intact. Screenshot the new Idle + Playing.
4. **T4 — docs:** `blink-drop-ux-design` banner note (sender simplified — progressive disclosure); README screenshot/wording if needed; CHANGELOG; bump 0.7.3 → 0.8.0.

## 6. Out of scope / invariants
- No wire/protocol/encryption/CSP change. No new dependency.
- **No feature removed** — everything is still reachable, just on demand.
- Honest-limits content is relocated, **not deleted** (encryption caveats, strength hint remain, in-context).
- Receiver untouched.

## 7. Release checklist (v0.8.0)
1. Branch `feat/v0.8.0-ui-simplification` → T1–T4 → PR (CI green) → merge.
2. Regression: biome, tsc, tests, PWA + single-file sender builds.
3. Bump `web` 0.7.3 → 0.8.0 + CHANGELOG.
4. Tag `v0.8.0` + release; Pages redeploys.
5. Visual confirm on the live sender.
