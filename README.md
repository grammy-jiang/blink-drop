# Blink-Drop

Offline small-file transfer via animated QR codes. A **web sender** (static,
client-side, no backend) turns a file into an animated sequence of QR codes; a
**native iOS receiver** watches the screen through its camera, reconstructs the
file, verifies it (SHA-256), and hands it to the iOS share sheet. No network,
cable, cloud, pairing, or accounts — only light crosses the gap.

## Status

- **M0 — protocol proof: done.** The wire protocol (Blockchain Commons UR/MUR +
  gzip + SHA-256) works end to end, verified on real iPhone optics. `web/` holds
  the sender plus a throwaway browser receiver used to prove the protocol.
- **MVP-1 — native iOS receiver: next.**

## Layout

| Path | What |
|------|------|
| `docs/` | The design pipeline: blueprint → protocol → architecture → UX design → roadmap |
| `docs/01-protocol.md` | The wire contract — the one thing both sides share |
| `web/` | The sender (vanilla TypeScript + Vite). See `web/README.md` |
| `shared/test-vectors/` | Executable protocol contract both implementations must pass |
| `ios/` | Native receiver (MVP-1 — not yet started) |

`web/` and `ios/` never depend on each other; they agree only via
`docs/01-protocol.md` and `shared/test-vectors/`.

## Develop

```bash
cd web
npm ci
npm test          # protocol core + shared-vector conformance
npm run dev       # sender dev server
```

Quality gates — Biome (lint + format), TypeScript typecheck, and Vitest — run in
CI and locally via pre-commit:

```bash
pip install pre-commit   # or pipx install pre-commit
pre-commit install       # enable the git hooks
```

See `docs/` for the full design and `docs/ios/primer.md` for the (zero-to-device)
iOS onboarding.
