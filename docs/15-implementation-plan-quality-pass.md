# Blink-Drop — Implementation Plan (v0.7.2: Lighthouse / a11y quality pass)

| | |
|---|---|
| **Status** | Draft v0.1 — findings from a live Lighthouse audit (2026-07-07) |
| **Target release** | **v0.7.2** |
| **Scope** | Fix the **real, in-our-code** Lighthouse findings on the two shipped pages (sender `index.html`, receiver `receiver.html`). No wire/protocol/behavior change — HTML `<head>` + one landmark element only. |
| **Why** | Never audited before. Live mobile Lighthouse: receiver **A11y 98 · Best-Practices 73 · SEO 91 · Agentic 100**. Of 5 failed audits, **2 are ours and trivially fixable**; the other 3 are environmental (browser extensions + Cloudflare edge injection) and not our code. |

---

## 1. Findings (live audit, https://grammy.jiang.is/blink-drop/receiver.html, mobile)

| # | Audit | Category | Ours? | Cause | Action |
|---|-------|----------|-------|-------|--------|
| F1 | `landmark-one-main` | A11y (98→100) | **YES** | No `<main>` landmark on either page | Add one `<main>` |
| F2 | `meta-description` | SEO (91→100) | **YES** | No `<meta name="description">` on either page | Add a description |
| F3 | `deprecations` | Best-Practices | **NO** | Deprecated APIs come from `chrome-extension://` sources (MetaMask `nkbihfb…`, automation ext `mclkkof…`) — Shared Storage / unload listeners. Not Blink-Drop. | None (environmental) |
| F4 | `errors-in-console` | Best-Practices | **NO** | Cloudflare **auto-injects** `static.cloudflareinsights.com/beacon.min.js` at the edge; our CSP `script-src 'self' 'wasm-unsafe-eval'` **correctly blocks it**. The console "error" is our no-egress policy working as designed. | Recommend (user): disable Cloudflare **Web Analytics** auto-injection for the zone — or accept it (the block is correct). |
| F5 | `inspector-issues` | Best-Practices | **NO** | Same Cloudflare beacon CSP block as F4. | Same as F4 |

**Interpretation.** Best-Practices 73 is dragged down entirely by things outside our code: the user's browser extensions (F3) and Cloudflare's own analytics beacon which our CSP blocks (F4/F5). In a clean browser with Cloudflare Web Analytics off, Best-Practices would score high. **We do not weaken the CSP to satisfy Lighthouse** — blocking third-party egress is the point (SG-3/SG-4).

## 2. Decisions

| # | Decision | Choice |
|---|----------|--------|
| **D1** | Fix scope | Only F1 + F2 (ours). F3–F5 are documented-not-fixed (environmental); no CSP relaxation. |
| **D2** | `<main>` placement | Receiver: change `<div id="app">` → `<main id="app">` (all `#app`/`.class` CSS is id/class-based, so layout is unchanged). Sender: wrap the body content in a single `<main>`. |
| **D3** | Descriptions | One honest sentence each, matching the no-upload/offline framing. No keyword stuffing. |
| **D4** | Perf | Not chased. Receiver bundle ≈243 KB / 80 KB gzip is dominated by `@ngraveio/bc-ur` (the fountain-code engine — cannot be dropped). Load is not a measured user problem for a camera-scanning PWA; optimizing it now would be premature. Recorded, not actioned. |

## 3. Tasks

1. **T1 — receiver.html:** `<div id="app">` → `<main id="app">`; add `<meta name="description" …>`.
2. **T2 — index.html (sender):** wrap body content in `<main>`; add `<meta name="description" …>`.
3. **T3 — verify:** rebuild; re-run live-equivalent Lighthouse (local preview) → confirm A11y 100 + SEO 100, no new failures; biome/tsc/tests still green (no TS touched, but run the suite).
4. **T4 — docs + release:** CHANGELOG; bump 0.7.1 → 0.7.2. Note the F4/F5 Cloudflare recommendation in the release notes.

## 4. Out of scope
- Any CSP change (F4/F5 stay blocked — correct behavior). Perf/bundle work (D4). Any sender/receiver behavior, wire, or crypto change. Cloudflare dashboard settings (user's call).

## 5. Release checklist (v0.7.2)
1. Branch `feat/v0.7.2-quality` → T1–T4 → PR (CI green) → merge.
2. Regression: biome, tsc, tests, PWA + single-file sender builds.
3. Bump `web` 0.7.1 → 0.7.2 + CHANGELOG.
4. Tag `v0.7.2` + release; Pages redeploys.
5. Optional (user): turn off Cloudflare Web Analytics auto-injection to clear F4/F5 on the live site.
