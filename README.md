# Blink-Drop

Offline small-file transfer via animated QR codes. A **web sender** (static,
client-side, no backend) turns a file into an animated sequence of QR codes; an
**installable web app (PWA) receiver** watches the screen through a phone's
camera, reconstructs the file, verifies it (SHA-256), and hands it to the share
sheet. No network, cable, cloud, pairing, or accounts — only light crosses the
gap.

## Try it

- **Receiver** (open on the phone, "Add to Home Screen" to install):
  <https://grammy.jiang.is/blink-drop/receiver.html>
- **Sender** (open on the other screen): <https://grammy.jiang.is/blink-drop/>

Pick or drop a file on the sender, point the phone receiver at the animation, and
keep it playing until the phone shows **Verified**.

## What it does

- **Offline by construction** — the file is processed in the browser and never
  uploaded (CSP forbids network egress). A single self-contained offline HTML
  sender is also built for air-gapped machines.
- **Optional passphrase encryption** — set a passphrase and the transfer is
  encrypted (**AES-256-GCM**; **PBKDF2** by default, opt-in **Argon2id**). The
  file *and its metadata* are sealed; the receiver prompts for the passphrase.
  Plaintext transfers are the default and are unchanged.
- **Honest receiver UX** — real progress denominator, stall guidance, a loud
  verify-failure that withholds the file, and **resume across restart** (an
  interrupted large scan continues instead of restarting; the partial is
  encrypted at rest).
- **Multiple files per transfer** — send several files in one animated stream
  (native manifest envelope). The receiver verifies **each file independently**
  and offers **Share all** or a single bundled **`.zip`** (the reliable path on
  iOS). Single-file transfers are byte-identical to before.
- **Share out** — the verified file goes to the OS share sheet (Web Share API)
  with a download fallback.

## Status

Shipping — latest **v0.9.4** (see [CHANGELOG.md](CHANGELOG.md)). The protocol is
proven on real iPhone optics and the PWA receiver is device-validated. The
**native iOS app is deferred** (its toolchain is macOS-only and the developer has
no Mac); the PWA is the receiver. `docs/ios/*` remain the future-native reference.

## Layout

| Path | What |
|------|------|
| `docs/` | The design pipeline: blueprint → protocol → architecture → UX design → roadmap → implementation plans |
| `docs/01-protocol.md` | The wire contract — the one thing both sides share |
| `web/` | The sender + PWA receiver (vanilla TypeScript + Vite). See `web/README.md` |
| `shared/test-vectors/` | Executable protocol contract any implementation must pass |
| `ios/` | **Deferred** future-native receiver reference (not built) |

`web/` reuses one isomorphic `web/src/core` for both the sender and the PWA
receiver; a future native receiver would agree only via `docs/01-protocol.md` and
`shared/test-vectors/`.

## Develop

```bash
cd web
npm ci
npm test            # protocol core, crypto, vectors, edge + resume
npm run dev         # sender + receiver dev server
npm run build       # the Pages site (sender + PWA receiver)
npm run build:sender  # the single-file offline sender
```

Quality gates — Biome (lint + format), TypeScript typecheck, and Vitest — run in
CI and locally via pre-commit:

```bash
pip install pre-commit   # or pipx install pre-commit
pre-commit install       # enable the git hooks
```

See `docs/` for the full design (blueprint, protocol, architecture + update
notes, UX, and the per-release implementation plans).
