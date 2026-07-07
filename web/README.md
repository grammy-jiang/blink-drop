# Blink-Drop — Web (sender + PWA receiver)

The web half of Blink-Drop (offline animated-QR file transfer): a static,
client-side **sender** and an installable **PWA receiver**, both built from one
isomorphic protocol core. No backend. See `../docs/` for the blueprint, protocol,
architecture (+ update notes), and UX design; this README is how to work in `web/`.

## What's here

- **`src/core/`** — the pure, isomorphic protocol core (envelope · gzip · SHA-256
  · UR/MUR transport · **passphrase encryption**). Runs in browser and node;
  bound to `../shared/test-vectors/`.
- **Sender** (`index.html` + `src/ui/sender.ts`) — pick or **drop** a file →
  plan/ETA → animated QR canvas; rate/density controls; optional **passphrase**
  (AES-256-GCM; PBKDF2 or opt-in **Argon2id**) + strength hint; soft-ceiling
  warning; a receiver-URL QR.
- **PWA receiver** (`receiver.html` + `src/ui/receiver.ts`) — camera scan → whole-%
  progress + stall guidance → SHA-256 verify → Web Share; encrypted passphrase
  prompt + distinct wrong-passphrase state; **resume across restart** (partial
  encrypted at rest). Installable (manifest + service worker). `receiver.html?debug`
  keeps the M0 loopback/stream self-tests.

## Commands

```bash
npm ci
npm test              # core, crypto, vectors, edge, resume, receiver (node + jsdom)
npm run typecheck     # tsc --noEmit
npm run dev           # Vite dev server (sender + receiver)
npm run build         # the Pages site: sender (index.html) + PWA receiver (receiver.html) -> dist/
npm run build:sender  # the single-file offline sender -> dist-sender/
npm run gen:vectors   # regenerate ../shared/test-vectors (deliberate — protocol-level change)
npm run gen:icons     # regenerate the PWA icons
```

## Layout

```
src/
  core/           # PURE protocol core — no DOM. Reused verbatim by sender AND receiver.
    cbor.ts       #   minimal deterministic CBOR for the [header, payload] / [outer, ciphertext] message
    gzip.ts       #   bounded gzip/gunzip (CompressionStream); decompression-bomb guard (SG-2)
    digest.ts     #   SHA-256 (WebCrypto)
    crypto.ts     #   passphrase encryption: AES-256-GCM + PBKDF2 / opt-in Argon2id (hash-wasm)
    types.ts      #   protocol constants + Header / envelope shapes
    envelope.ts   #   file <-> message; plaintext + encrypted variants; SHA-256 gate (SG-1)
    ur.ts         #   message <-> UR/MUR parts (bc-ur); the only bc-ur boundary
    index.ts      #   public API + encodeFileToQrParts / decodeQrPartsToFile
  qr/             # QR render (qrcode-generator) + scan (jsQR)
  player/         # the sender's frame player (loops systematic + fountain parts)
  receiver/       # camera.ts, share.ts (Web Share), resume.ts (encrypted-at-rest partial)
  ui/             # sender.ts, receiver.ts, debug.ts, size.ts
scripts/          # gen-vectors, gen-icons, gen-static-qr
test/             # vitest: core, crypto, vectors, edge, resume, receiver
vite-csp.ts       # build-time CSP injection (no-egress; 'wasm-unsafe-eval' for Argon2)
```

## Notes

- `src/core/` must not import from `qr/`, `player/`, `ui/`, `receiver/` — it is the
  piece bound to the test vectors and reused by both surfaces.
- **Encryption at rest (receiver resume):** `receiver/resume.ts` stores the partial
  AES-GCM-encrypted under a receiver-local **non-extractable** key in IndexedDB.
- **QR encode:** `qrcode-generator` (kazuhikoarase), not nayuki's `qrcodegen`
  (unpublished on npm). **QR decode:** `jsQR` (pure JS), chosen over the native
  `BarcodeDetector` (absent on desktop Linux Chrome and iOS Safari).
- **Browser polyfills:** bc-ur needs node's `Buffer` and `process`; `src/polyfill.ts`
  supplies both and is imported first in each browser entry.
- `npm audit` advisories are in the **dev** toolchain (vite/esbuild) only; none is
  in a runtime dependency or the shipped artifact.
```
