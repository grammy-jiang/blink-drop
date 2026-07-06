# Blink-Drop — iOS Receiver Architecture

| | |
|---|---|
| **Status** | Draft v0.1 |
| **Date** | 2026-07-07 |
| **Depends on** | `../01-protocol.md` (v0.1) — the wire contract; `../00-blueprint.md` (v0.3) — §6.2 receiver workflow, R-INTEGRITY |
| **Governs** | `ios/` only. **Must not** reference `web/`. Shared surface is the protocol + `shared/test-vectors/`. |
| **Audience note** | The developer is new to iOS. This doc states *what* and *why*; the step-by-step *how* (Xcode, signing, running on device) lives in `primer.md`. |

---

## 0. Decisions resolved

| Ref | Decision | Value |
|-----|----------|-------|
| OQ-3 | Minimum iOS version | **iOS 17** |
| — | UI framework | **SwiftUI** |
| — | UR/MUR codec | **URKit** (Swift Package Manager) — protocol §12 |
| — | Camera + QR decode | **AVFoundation `AVCaptureMetadataOutput`** (built-in, real-time QR → string); Vision as documented fallback |
| — | Digest | **CryptoKit `SHA256`** — protocol §7 |
| — | Decompress | **`Compression` / zlib** (bounded, protocol §9) |
| — | Share / save | SwiftUI **`ShareLink`** (share sheet) + **`.fileExporter`** (save to Files) |

### Why iOS 17 (OQ-3)

The target device (iPhone 15 Pro Max) runs the latest iOS, so the floor only constrains which APIs we may use — and iOS 17 unlocks the ones that make this app small: the `@Observable` macro (clean view-model state for the §6.2 machine) and a mature `ShareLink`. `AVCaptureMetadataOutput` has existed since iOS 6, so real-time QR decode is not gated. Adopting UR means we decode **strings**, not binary, so we never needed the iOS-17-only `VNBarcodeObservation.payloadData` binary path — iOS 17 is chosen for ergonomics and headroom, not necessity. For personal sideloading this floor costs nothing.

## 1. Responsibilities

**Does:** open straight to the camera → capture QR frames off the sender's screen → feed decoded UR strings to URKit → reassemble the message → CBOR-decode the header → bounded-gunzip → **verify SHA-256 before exposing anything** → present the file to the iOS share sheet / Files (blueprint §6.2).

**Does not:** touch the network, persist beyond the current transfer (no resume in v1), or display anything back toward the sender (one-way channel).

## 2. Module map

Same core/shell split as the web side; `Core` is pure Swift, no UIKit/SwiftUI, unit-tested against the **same** `shared/test-vectors/`.

```
ios/BlinkDrop/
├── Core/                     # PURE Swift — the protocol envelope. Mirrors web/src/core.
│   ├── Envelope.swift        #   assembled message → dCBOR decode → Header; bounded gunzip (protocol §9)
│   ├── URAssembler.swift     #   wrap URKit URDecoder: feed parts → completed message
│   ├── Digest.swift          #   CryptoKit SHA-256; verify(original) == header.sha256
│   ├── Gzip.swift            #   Compression/zlib bounded inflate
│   └── Types.swift           #   Header, protocol constants (map keys, compression enum)
├── Capture/
│   ├── CaptureSession.swift  #   AVCaptureSession + AVCaptureMetadataOutput → UR strings (deduped)
│   └── CameraPreview.swift   #   UIViewRepresentable over AVCaptureVideoPreviewLayer
├── ViewModel/
│   └── TransferModel.swift   #   @Observable; drives §6.2 states; progress from URDecoder
├── Views/                    # SwiftUI, one per §6.2 state surface
│   ├── ScanView.swift        #   Ready/Locked/Collecting: preview + progress overlay + stall guidance
│   ├── ResultView.swift      #   Complete: file card + ShareLink + .fileExporter
│   └── FailView.swift        #   Failed: loud message, keep-scanning / restart
└── BlinkDropApp.swift        # entry; opens ScanView
```

**Hard boundary:** `Core` imports only Foundation/CryptoKit/Compression + URKit — no capture, no SwiftUI. It is the unit-testable, protocol-bound piece; everything device-specific sits above it.

## 3. Capture → deliver pipeline

```
AVCaptureMetadataOutput  ──(.qr, stringValue)──►  dedupe  ──►  URDecoder.receivePart(lowercased)
                                                                      │  (URKit: fountain reassembly, CRC-32 grouping)
                                                                      ▼
                                                          message complete? ──►  Core.Envelope.decode
                                                                                      │  CBOR → Header
                                                                                      ▼
                                                                             bounded gunzip (orig_size, §9)
                                                                                      │
                                                                                      ▼
                                                                        SHA-256 == header.sha256 ?
                                                                          yes → Complete (share)   no → Failed
```

- **`AVCaptureMetadataOutput`** does hardware-accelerated QR detection and hands back `stringValue` continuously — exactly what we need, since UR is text (protocol §6). Lowercase it (UR is case-insensitive; sender sent uppercase for alphanumeric QR).
- **Dedupe** repeated captures cheaply before touching URKit (R-DEDUPE) — the camera sees each frame several times.
- **URKit `URDecoder`** owns fountain reassembly, part grouping by CRC-32 (R-SESSION), and exposes `estimatedPercentComplete` / expected-part counts for the progress denominator (R-SELFDESC).
- **Throughput fallback:** if `AVCaptureMetadataOutput` coalesces/throttles too aggressively for ~10 fps of *distinct* frames, switch to `AVCaptureVideoDataOutput` + `VNDetectBarcodesRequest` on the sample buffers for finer control. Documented as a known lever; start simple.

## 4. State → UI mapping (blueprint §6.2)

| State | View | Data source |
|-------|------|-------------|
| Ready | `ScanView` (viewfinder, "point at the animation") | camera running, no parts yet |
| Locked | `ScanView` (size + ETA appear) | first part → `messageLen` (byte size + denominator; name at reassembly, protocol §4) |
| Collecting | `ScanView` (progress ring, rate, stall hint) | `URDecoder` percent / part counts; stall = no progress for N s |
| Reconstructing | `ScanView` ("assembling…") | message complete, `Core.Envelope.decode` running |
| Verifying | `ScanView` ("verifying…") | `Digest` compare |
| Complete | `ResultView` (name/size/type, *verified* badge, ShareLink, save) | decoded file in temp |
| Failed | `FailView` (loud, no file, keep-scan/restart) | digest mismatch or unrecoverable |

`TransferModel` is a single `@Observable` holding the state enum + progress; the views are thin renderers of it.

## 5. Verify & deliver (R-INTEGRITY)

- Nothing is written anywhere the user can reach until **SHA-256 passes** (protocol §7). On success, write the reconstructed bytes to a temporary file named `header.name`, then hand *that URL* to `ShareLink` (share sheet: Messages, Mail, AirDrop, WhatsApp, Files…) and offer `.fileExporter` for a direct Save-to-Files.
- On failure the temp file is never created; `FailView` states it plainly and offers keep-scanning / restart — never "accept anyway."
- **Decompression bound** (protocol §9): the gunzip is capped at `header.orig_size` + a hard ceiling; overflow → `Failed`.

## 6. Permissions & Info.plist

- `NSCameraUsageDescription` is **required** — the app cannot open the camera without it (crash on launch of capture otherwise). Copy: "Blink-Drop uses the camera to scan the animated QR codes on another screen." Setup steps in `primer.md`.
- No other permission needed: no network entitlement, no photo library, no location.

## 7. Testing

- **Unit (`Core`, XCTest):** run the **same** `shared/test-vectors/` — tier-1 framing (feed `parts.txt` strings to `URAssembler`, assert the assembled message hex; and the reverse) and tier-2 round-trip (`envelope decode` → `SHA-256 == meta.sha256`). This is what proves Swift and TypeScript agree on the wire.
- **On-device (manual, required):** capture is untestable in the Simulator (no camera). Real screen→camera runs against the web sender / M0 receiver output on the actual iPhone.
- Keep `Capture` thin so the untestable-in-CI part is as small as possible.

## 8. Handoff

- Pin the `URKit` version in the Xcode project (SPM `Package.resolved` committed) at first implementation.
- `primer.md` covers: install Xcode, free-Apple-ID signing, add URKit via SPM, camera permission, run on device, the 7-day re-sign loop.
- `Core` is the shared, protocol-bound module — changes to it are protocol-adjacent (re-run vectors on both sides).
- UX detail for the §6.2 surfaces (progress ring behaviour, stall thresholds, framing guidance copy) is refined in the upcoming **ux-design** stage before the M2 build.
