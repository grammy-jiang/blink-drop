# Blink-Drop — Sender Playing-state focus (UI simplification)

| | |
|---|---|
| **Status** | Draft v0.1 — per a UX review (2026-07-08): "each step should show only the necessary elements" |
| **Scope** | Sender only. When a transfer is Playing, hide the *setup* controls so the page shows only what that step needs. No wire/protocol/crypto change; receiver untouched. |

## Problem

The sender is **additive**: `#stage` (QR + controls) appears *below* the persistent idle block, so while Playing the page still shows the dropzone, "🔒 Add passphrase", "📱 Phone link", and the tagline — none needed during a transfer — and the QR is pushed to mid-page. The receiver already does the right thing (it swaps one clean screen per state).

## Fix

Make the sender state-swap like the receiver, minimally: wrap the setup controls in a `#setup` container and toggle it.

- **Idle** — show: `Blink-Drop` · `Offline. Nothing uploaded.` · dropzone · 🔒 Add passphrase · 📱 Phone link. (`#stage` hidden.)
- **Playing** — hide `#setup`; show: `Blink-Drop` · caution (if unencrypted) · QR · plan · cue · Stop · Adjust · status.
- **Stop** returns to Idle: reveal `#setup`, hide `#stage`, clear caution/size-warn/status, reset the file input.

Elements kept in the transfer view are exactly the necessary ones; `sizewarn`/`caution` remain (they are transfer feedback), the brand stays (identity, as on every receiver screen).

## Implementation

- `index.html`: wrap `tagline + dropzone + #file + .disclosures` in `<div id="setup">`; leave `h1.brand`, `#sizewarn`, `#caution`, `#stage` as siblings.
- `sender.ts`: `const setupEl = el("setup")`. In `processFiles`, `setupEl.hidden = true`. In the Stop handler, reset to Idle (`setupEl.hidden = false; stageEl.hidden = true; caution/sizewarn/status cleared; fileInput.value = ""`).

## Non-goals
- No change to Idle's element set (it is already minimal), the receiver, or any wire/crypto behavior.
- No new copy; reuse existing strings.

## Test
- Both viewports (desktop + phone 390px) screenshots: Idle shows only setup; Playing shows only the transfer view (no dropzone/disclosures/tagline); Stop returns to a clean Idle. Encrypted + plaintext. Existing sender unit tests (`sender-ui.test.ts`) updated for the `#setup` toggle.
