# Blink-Drop — Large-File Latency Plan (capability budget)

| | |
|---|---|
| **Status** | Draft v0.2 — cut the "stuck at 99%" wait on large (200 KB+) transfers by matching the software knobs to the device (2026-07-10) |
| **Scope** | A **capability budget**: every software knob (fragment, redundancy, sender fps) sized to a hardware limit (camera resolution, CPU decode rate). Sender defaults tuned to the iPhone 15 Pro Max; the **receiver measures and displays its real capability** so the human can match the sender to it. Fragment + redundancy live-tunable via sender URL params. **No wire-format change.** |

## Update — on-device results (2026-07-10)

First real-device test (15 Pro Max) confirmed the fix — **no last-1% wait** — and
corrected one assumption, so the defaults were retuned:

- **The device reports 1080p `getUserMedia`, not 720p.** My 720p figure below (from
  stale web sources) was conservative; the receiver's capability line showed
  `1080p · scan ~19 fps · keep sender ≤ 9` on-device. The A17 scans 1080p at
  ~19 fps, so there is far more pixel headroom than budgeted.
- **Camera request 720p → 1080p** (`camera.ts`) — match the reality, and help
  devices that honour the down-scale.
- **Default fragment 800 → 1200 B** (v30 QR, ~5.1 px/module at 1080p) — **half**
  the frames of the original 600 B. Clamp ceiling raised 1200 → 1500 for upward
  sweeps.
- **Scan timer added** — starts on the first received frame (excludes aiming),
  freezes at reconstruction (excludes verify/decrypt), shown live during
  Collecting and as "Received in Ns" on the Verified screen. Turns the sweep into
  hard numbers.

The budget proved self-consistent out of the box: sender ~8 fps ≤ the receiver's
recommended ≤ 9. The §2 table below keeps the original 720p estimate as the
reasoning trail; the shipped values are 1080p / 1200 B.

## 1. Problem

Large files (≥200 KB ⇒ ~342 fragments at 600 B) take ~60 s per loop and then
**stall near 99%** re-catching the last few frames. Simulation against the real
bc-ur decoder showed **no catastrophic algorithmic tail** — the fix is not a
rewrite but *fewer frames* + *fewer per-frame misses* + *not displaying faster
than the scanner can capture*.

## 2. Principle — hardware and software must be consistent

Each software knob has a hardware ceiling. Picking values above the ceiling is
what *causes* the tail. The budget for the target device (iPhone 15 Pro Max: 48 MP
ƒ/1.78, sensor-shift OIS, 100% Focus Pixels — optics are not the limiter):

| Software knob | Hardware limit | Consistent value |
|---|---|---|
| **Fragment size** | camera resolution — iOS Safari caps `getUserMedia` at **720p** | ≤ ~800 B (v24 QR, **4.1 px/module** @720p = today's proven margin) |
| **Sender fps** | receiver scan fps (must oversample ~2× to catch every frame) | ≤ **½ × scan fps** ⇒ cap at **10**, not 15 |
| **Receiver scan fps** | A17 Pro jsQR decode time at 720p | ~20 fps target — **measured on-device**, not assumed |
| **Redundancy** | residual per-frame miss rate | **2×** |

The key mistake to design out: the current sender fps ceiling (15) against a
~20 fps scanner is only 1.3× oversampling → systematic misses → the tail.
**Faster display is the wrong lever;** fewer frames + guaranteed capture is right.

## 3. Constraint + resolution — decoupled devices, human as the channel

Sender and receiver have **no back-channel** (locked design rule), so they cannot
negotiate the budget at runtime. Chosen resolution (static + capability display):

- **Sender:** defaults + fps ceiling hard-tuned to the 15 Pro Max @ 720p;
  fragment + redundancy overridable via URL params for on-device A/B.
- **Receiver:** measures its **real** resolution (`track.getSettings()` /
  `video.videoWidth`) and **real** scan fps (time the jsQR loop), and **displays**
  them ("720p · ~18 fps"). The human reads that and dials the sender speed to
  match — the human is the back-channel, per the existing design philosophy.
- **Not** doing (declined): a CPU-adaptive scan interval. The loop stays a fixed
  50 ms; we only *measure and show* the achieved rate.

## 4. Changes

**Sender**
- `web/src/core/types.ts` — `DEFAULT_MAX_FRAGMENT_LENGTH` 600 → 800; add
  `DEFAULT_REDUNDANCY = 2`, `MIN/MAX_FRAGMENT_LENGTH` (300/1200),
  `MIN/MAX_REDUNDANCY` (1/5).
- `web/index.html` — `#rate` input `max="15"` → `max="10"` (fps ceiling).
- `web/src/ui/sender.ts` — pure `parseTransferParams(search)` (clamped) →
  `frag` / `redundancy` used by `systematicQrParts` + `qrPartStream`.
  Params: `?frag=<300..1200>` (default 800), `?redundancy=<1..5>` (default 2).

**Receiver**
- `web/src/receiver/camera.ts` — request 720p (`width/height: { ideal }`); add an
  optional `onStats` callback reporting `{ width, height, scanFps, decodeMs }`
  (rolling), measured with `performance.now()` (production code — the no-timer
  test rule is about determinism in *tests*, not the camera loop).
- `web/src/ui/receiver.ts` + `web/receiver.html` — a small muted capability line
  in the scanning view ("{w}×{h} · scan ~{fps} fps"), styled consistently with
  the existing receiver text.

**Tests**
- `web/test/transfer-params.test.ts` — clamp / default / NaN table for
  `parseTransferParams`.
- A `camera`-stats unit where feasible (rolling-fps helper extracted pure).

## 5. Robustness / non-breaking

- **Wire:** fragment size + redundancy are sender-side; bc-ur embeds `seqLen`, so
  the receiver reconstructs any values. Denser QR changes only the optical layer.
  `MAX_SEQ_LEN` guard unaffected (bigger fragments ⇒ smaller seqLen).
- **QR ceiling:** clamp fragment ≤ 1200 B (v30, well under QR v40) so a bad param
  can't demand an impossible symbol.
- **Camera:** `ideal` constraints degrade, never throw; lesser devices still get
  their best resolution and the displayed capability tells the truth for *that*
  device.
- **fps ceiling:** input `max` lowered so the UI cannot select an inconsistent
  speed; existing saved values above the cap clamp on read.

## 6. Verification

- Unit: `parseTransferParams` + rolling-fps helper.
- E2E: `roundtrip` / `receiver` specs still green with the 800 B default.
- UI: both viewports (desktop + 390 px) and both themes for the receiver
  capability line; force past the service-worker cache to confirm the new build.
- **On-device (the real test):** 15 Pro Max, 200 KB+ file, sweep
  `?frag=800→900→1000` / `?redundancy=2→3`, read the receiver's shown res + fps,
  set sender speed ≤ ½ of it. Lock the winning defaults in a follow-up.

## 7. Out of scope

- Continuous `nextPart()` streaming — evaluated, modest middle-tier win; not worth
  the player refactor now.
- Manual chunking — measured neutral-to-worse for wall-clock; dropped.
- CPU-adaptive scan interval — deferred (measure-and-show only for now).
