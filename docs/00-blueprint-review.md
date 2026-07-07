# Blink-Drop Blueprint — Review Comments

> **📎 Historical (2026-07-07).** A point-in-time review of blueprint **v0.2**. Its findings were applied (v0.3), and the blueprint has since moved to **v0.5** (post PWA-pivot). Kept for the record — do not read as the current spec.

| | |
|---|---|
| **Target** | `docs/00-blueprint.md` (Draft v0.2) |
| **Reviewer** | `product-blueprint-reviewer` (subagent-factory) |
| **Altitude** | Blueprint stage — technology-neutral product definition. Architecture/protocol/library concerns deliberately out of scope (deferred by the document to `docs/web/`, `docs/ios/`, `01-protocol.md`). |
| **Date** | 2026-07-07 |
| **Verdict** | 6 must-fix (2 security), 4 nice-to-have. Neutrality and prior-art grounding are strong; gaps cluster on cross-section consistency and an under-stated security posture. |

## Summary

| Class | Count | Theme |
|-------|-------|-------|
| Must-fix | 6 | cross-section consistency (#1, #3, #5, #6) + security posture (#2, #4) |
| Nice-to-have | 4 | diagrams, assumptions list, figure divergence, criterion headroom |

Findings cluster on **cross-section consistency** and **security posture** — for a tool whose whole pitch is "bypass the controls," the security stance is under-stated.

---

## Must-fix

### 1. Stream-parameters contradiction — §5 (R-ADJUST) vs §7 (Session)

**Issue.** R-ADJUST says the sender may change "stream parameters (rate, density)" mid-transfer without losing progress. §7's Session entity lists "stream parameters (partition size, count)" as "Immutable once playback starts." Same phrase, two different referents, opposite mutability claims. §3 ties *density* directly to bytes-per-frame — which is what *partition size* governs — so the two may be substantively coupled, not merely homonymous.

**Why it matters.** A protocol author could read §7 and conclude R-ADJUST is unsupported, or read §5 and make partitioning mutable when reconstruction (R-SUBSET / R-SESSION) likely depends on it staying fixed.

**Fix.** Rename to disambiguate — "partitioning scheme" (immutable) vs. "presentation parameters: rate, density" (mutable). State how a partition survives a density change. Add it as its own row in §13 (not currently covered by OQ-1 or OQ-4).

### 2. Missing risk: dual-use / data-exfiltration potential — §12 *(security)*

**Issue.** §1/§2 sell the product as moving data past blocked Wi-Fi, USB, cloud, and air gaps — exactly the profile of a DLP-bypass / insider-exfiltration channel. Risk 4 covers a bystander reading the payload (eavesdropping) but nothing covers the mirror case: an authorized-but-malicious user moving data *out* of a locked-down environment through a channel invisible to network/USB monitoring.

**Why it matters.** First-order product risk tied to the product's own core value proposition, not a technical detail. It needs a stated posture, not a countermeasure.

**Fix.** Add a risk row naming the dual-use tension and stating Blink-Drop's position (e.g. "assumes an authorized user moving their own data; not designed to evade DLP controls; unauthorized use is explicit misuse") — or accept the risk explicitly with no mitigation, but say so.

### 3. Untested requirements — §5 vs §11

**Issue.** Mapping R-* to S*: R-INTEGRITY→S2 and R-OFFLINE→S7 are clean; R-SUBSET is covered by S3/S4. But **R-DEDUPE, R-SESSION, and R-ADJUST have no matching success criterion at all**, and R-SELFDESC / R-META are only indirectly touched by S5 — for timing only (`<10s`), never for correctness of the metadata/position surfaced.

**Why it matters.** R-ADJUST is the backbone of the human-feedback-loop design (§6.4) and a named Risk-2 mitigation. Without a criterion, an implementation could violate R-ADJUST, R-SESSION, or R-DEDUPE and the acceptance suite would never catch it.

**Fix.** Add criteria (e.g. "adjusting rate/density mid-transfer costs zero already-collected progress"; "a competing session's frames are ignored") — or explicitly state in §11 that these three are validated by protocol-conformance checks instead of end-to-end criteria. Either way, say so rather than leaving it silent.

### 4. Vague, under-gated mitigation for U2's core risk — §12 Risk 4, §2 U2, §9 *(security)*

**Issue.** U2 ("credential / key material handoff") is a headline use case; Risk 4 names it explicitly as "the exposed case" for optical eavesdropping; the only mitigation is "user judgment for sensitive payloads," with encryption pushed to a soft v1.1 backlog item.

**Why it matters.** Shipping a tool whose headline use case is credential handoff with zero confidentiality protection deserves a visible decision, not a one-line risk-table note.

**Fix.** Either narrow U2's v1 claim explicitly (e.g. "non-secret key material only until v1.1 encryption ships") or turn this into an explicit decision point in §13 ("confirm shipping without encryption is acceptable given U2") rather than a passive mitigation.

### 5. M0 milestone framed inconsistently — §9 vs §12/§13

**Issue.** §9's "Out" list places the browser-based receiver prototype among permanently-excluded, backlog-style items ("explicitly not v1"). Risk 6 and OQ-8 describe the same artifact as **M0** — a deliberate precursor stage built *before* native work to de-risk the protocol. A sequenced milestone, not an excluded feature.

**Why it matters.** §9 is the section a reader treats as the authoritative MVP contract. As written, it hides that a staged delivery path (M0 → native v1) exists.

**Fix.** Have §9 name M0 explicitly as a preceding milestone in the delivery path, distinct from the genuinely-excluded items (multi-file, Android, localization) it's currently grouped with.

### 6. §13 open-questions table lacks dependency structure + no security-review call-out

**Issue.** The nine OQs are listed in flat ID order with only a "Lands in" destination — nothing signals that OQ-1 (adopt vs. custom stream format) likely gates OQ-2, OQ-4, OQ-6, and OQ-7 (an adopted spec would answer several together; a custom format leaves them independently open). Separately, despite U2, Risk 4, and finding #2 all being in this document, nothing recommends a security-review pass.

**Why it matters.** Resolving gated questions out of order risks avoidable rework, and a solo developer with no explicit prompt could easily never schedule a security-review pass.

**Fix.** Add a "Depends On" note to the OQ table (at minimum flag OQ-1 as gating OQ-2/4/6/7), and add one explicit line recommending a security-review pass, tied to the U2/Risk-4/exfiltration signals already present.

---

## Nice-to-have

### 7. No workflow diagram for either state machine — §6

§6 calls itself "the heart of the product... two small state machines," yet both are presented only as prose tables, and at least one transition is left implicit (Paused/Adjusted → Playing, on resume). A simple state diagram per side would let a downstream reader confirm the exact transition set at a glance. Low cost, real value given how central this section is.

### 8. No consolidated "Assumptions" list, separate from "Open Questions" — whole document

Several load-bearing premises are never labeled as assumptions distinct from decisions or deferred questions — notably that the prior-art optical-channel envelope figures (§3) transfer to Blink-Drop's own target hardware (only implicitly hedged via Risk 2 + the L9 sweep-harness plan), and that the stated primary persona/use-cases (§2) reflect real demand (asserted without citation, unlike almost everything else). Consolidating these in one place would make "working assumption" visibly distinct from "decided" or "deferred to stage X."

### 9. Headline throughput figure and worked transfer-time table diverge by an unexplained factor — §3

"~1 KB × 10 fps ≈ 8–10 KB/s" implies ~1.1 s for 10 KB and ~11 s for 100 KB, but the table states ~2 s and ~15–25 s (~1.8×); at 1 MB and 2 MB the gap shrinks to ~1.3×. The pattern is plausible — a fixed lock-on/session-acquisition cost plus coupon-collector-style over-collection would hit small transfers proportionally harder — but the document never says this, leaving an apparent contradiction. A one-line explanation would remove it.

### 10. S6 has zero headroom against the envelope's own estimate — §11

S6 requires 2 MB to complete in "< 6 min," and §3's own table estimates 2 MB at "~4–6 min" — the criterion sits exactly at the top of the blueprint's own estimated range, with no margin against the optical variability named as Risk 2. First real-device acceptance testing risks failing this on ordinary variance alone. Consider loosening S6 slightly or noting the range already anticipates worst-case conditions.

---

## What the blueprint does well

- **Implementation neutrality is genuinely disciplined.** Every named-technology decision — stream format, payload mode, compression, digest algorithm, session-identity scheme, minimum OS version, offline-packaging mechanism — is deferred to an explicit, labeled open question routed to a specific downstream document (§13). Rarer and harder to sustain than it looks.
- **Traceability to prior art is strong.** Nearly every workflow lesson (§8, L1–L9) cites a specific source, and empirical figures are consistently hedged ("observed," "planning figure," "roughly") with validation explicitly deferred to a to-be-built sweep harness — correct handling of an engineering gap.
- **The one-way-channel reasoning is coherent end to end.** The asymmetric sender/receiver progress model (§6.3), the "human closes the loop" design (§6.4), and the receiver-only post-verification completion rule all follow logically from the four channel properties in §4; state terminology is identical between §6.2 and §7's Transfer entity.
- **§9 (MVP) and §10 (Non-Goals) are meaningfully distinct** — temporal "not yet" vs. permanent product identity — and the In list doesn't leak anything the Out list or Non-Goals contradict.
- **Test-plan sizes are traceable to the use-case table**, not arbitrary: S1's 100 KB matches U4's upper bound, S6/the soft ceiling's 2 MB matches U3's upper bound.
- **Risk 6 is unusually honest** — naming "solo developer new to the receiver platform" as a project risk, with a concrete mitigation (onboarding primer + M0 de-risking prototype), is a category most blueprints omit.

## Reviewer calibration note

Lean-startup hypothesis-discipline checks (customer probing, canvas hypotheses, convergence claims) were **not** applied — this document has none of that machinery, and Appendix A's evidence is engineering/prior-art precedent, not customer-discovery probing, so that lens doesn't fit a solo-developer technical-tool blueprint. One adjacent minor observation: the primary persona and U1–U5 (§2) are asserted without citation, unlike nearly everything else — reasonable at this project's scale, worth only a one-line acknowledgment that they're design hypotheses, not validated segments.
