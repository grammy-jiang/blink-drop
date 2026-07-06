# Blink-Drop — Web Sender

The sender half of Blink-Drop (offline animated-QR file transfer). Static,
client-side, no backend. See `../docs/` for the blueprint, protocol, architecture,
and UX design; this README is just how to work in `web/`.

## Status (M0)

- ✅ `src/core/` — the protocol core (envelope · gzip · SHA-256 · UR/MUR transport). Pure, isomorphic (runs in browser and node), tested (19/19).
- ✅ `../shared/test-vectors/` — the cross-language contract (generated here).
- ✅ Sender UI (`index.html` + `src/ui/sender.ts`) — drop → plan/ETA → animated canvas → rate/scale controls. Verified rendering in a real browser.
- ✅ Throwaway browser receiver (`receiver.html` + `src/ui/receiver.ts`) — camera mode plus two automatable proofs, both PASS in-browser:
  - `receiver.html?selftest` — camera-free loopback: core → QR render → jsQR → core → verify (1/1 and 16/16 render→scan, verified).
  - `receiver.html?streamtest` — through the **real camera code path** via `canvas.captureStream()` (synthetic camera): sender canvas → MediaStream → video → sample loop → jsQR → verify (seqLen 13, 101 frames sampled, verified). Exercises the video sampling the loopback skips.
- ⏳ Real optics only (physical lens/glare/focus) — the entire software camera path is proven; only a genuine phone camera pointed at a screen remains (E2E-2).

### Run the phone test

```bash
npm run dev -- --host        # expose on the LAN
# laptop: open http://<laptop-ip>:5173/  (sender), pick a file
# phone:  open http://<laptop-ip>:5173/receiver.html, tap "Start camera", aim at the animation
```

## Commands

```bash
npm install        # deps: @ngraveio/bc-ur (runtime) + vite/vitest/tsx (dev)
npm test           # run the core + vector test suite (node env, no browser)
npm run dev        # Vite dev server (once the UI exists)
npm run build      # single-file offline build -> dist/ (vite-plugin-singlefile)
npm run gen:vectors  # regenerate ../shared/test-vectors (deliberate — protocol-level change)
```

Type-check: `npx tsc --noEmit -p tsconfig.json`.

## Layout

```
src/core/        # PURE protocol core — no DOM. The M0 browser receiver reuses this unchanged.
  cbor.ts        #   minimal deterministic CBOR for the [header, payload] message
  gzip.ts        #   bounded gzip/gunzip (CompressionStream); decompression-bomb guard (SG-2)
  digest.ts      #   SHA-256 (WebCrypto)
  types.ts       #   protocol constants + Header shape
  envelope.ts    #   file <-> message; SHA-256 acceptance gate (SG-1)
  ur.ts          #   message <-> UR/MUR parts (bc-ur); the only bc-ur boundary
  index.ts       #   public API + encodeFileToQrParts / decodeQrPartsToFile
scripts/gen-vectors.ts   # regenerates the shared test vectors
test/            # vitest: core behaviour + shared-vector conformance
```

## Notes

- `src/core/` must never import from the (future) `qr/`, `player/`, `ui/` — it is
  the piece bound to the test vectors and reused by the M0 receiver.
- bc-ur uses node `Buffer`; the browser build will supply a polyfill (added with
  the UI). Core tests run in node where `Buffer` is native.
- npm audit reports advisories in the **dev** toolchain (vitest/vite/esbuild)
  only; none is in the runtime dependency or the shipped offline artifact.
- **QR encode lib:** `qrcode-generator` (kazuhikoarase), not nayuki `qrcodegen`
  as the architecture doc names — nayuki's is not published to npm (`qrcodegen`
  there is an empty squat). `qrcode-generator` is equivalent for our needs
  (explicit Alphanumeric mode + ECC-L). **QR decode:** `jsQR` (pure JS), chosen
  over the native `BarcodeDetector` because the latter is absent on desktop Linux
  Chrome and iOS Safari.
- **Browser polyfills:** bc-ur needs node's `Buffer` and `process` globals;
  `src/polyfill.ts` supplies both and must be imported first in each browser entry.
```
