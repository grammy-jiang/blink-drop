# Blink-Drop — Security Hardening Plan (v0.10.x)

| | |
|---|---|
| **Status** | Draft v0.1 — proactive hardening review of the shipped v0.9.6 code (2026-07-08) |
| **Target release** | **v0.10.0** (core) + **v0.10.1** (passphrase UX + Trusted Types) |
| **Scope** | Close the gaps found in a code- and deployment-grounded review. Tightens the delivery layer (CSP), adds a decoder depth bound, a supply-chain CI gate, a passphrase-strength nudge, and Trusted Types. **No wire/protocol/envelope change** — every existing transfer stays byte-compatible. Cloudflare-edge items are handed off as an operator checklist (§5). |

---

## 1. What is already strong (verified — no work needed)

Grounded in the actual source, not assumed:

- **AEAD, downgrade-proof** — AES-256-GCM with the whole cleartext outer header (kdf, iterations, salt, cipher, nonce) bound as AAD (`crypto.ts` `aesGcmEncrypt`; `envelope.ts` `encryptInner`). Params cannot be tampered without breaking the tag.
- **Fresh CSPRNG salt + nonce per transfer** (`crypto.randomBytes`, `SALT_BYTES=16`, `GCM_NONCE_BYTES=12`). A reused passphrase still yields a distinct key.
- **KDF at OWASP-2023 floors** — PBKDF2-HMAC-SHA-256 `600_000` iterations; Argon2id `m=19 MiB, t=2, p=1` (`types.ts`).
- **Bomb bounds everywhere** — `MAX_PBKDF2_ITERATIONS`, `MAX_ARGON2`, `MAX_SEQ_LEN` (fountain array), `HARD_MAX_DECOMPRESSED_BYTES`, `MAX_TOTAL_DECOMPRESSED_BYTES`, `MAX_FILE_COUNT`. KDF cost is bounded *because* derivation runs before the AEAD tag check.
- **Fail-closed** — unknown kdf / cipher / envelope version → `MalformedMessageError`; a build without Argon2 never mis-accepts an Argon2 message.
- **SHA-256 acceptance gate** — `finishOpen` returns nothing unless the reconstructed bytes match the declared digest (`DigestMismatchError` otherwise).
- **Metadata sealed** — compress-then-encrypt; name/type/size/hash ride *inside* the ciphertext.
- **Receiver input discipline** — `safeName()` (basename-only, control-strip, length cap) at every OS boundary; filenames set via `textContent`, never `innerHTML`.
- **Sender egress already forbidden** — sender CSP `connect-src 'none'`.
- **Reproducible deps** — `package-lock.json` committed.

The core is well-built. The gaps are at the **edges**: the delivery layer, one decoder path, supply-chain automation, and the human passphrase.

## 2. Findings (code- and deployment-grounded)

| # | Finding | Severity | Batch |
|---|---------|----------|-------|
| **A1** | Receiver CSP `connect-src 'self'` is looser than needed. The receiver **window** makes zero network requests (no `fetch`/XHR/WebSocket/beacon in `src`). Service-worker precache runs in the worker context and is **not** governed by the page's `connect-src`. → tighten to `'none'`. | Med | v0.10.0 |
| **A2** | Sender CSP `script-src` carries `'unsafe-inline'`. The hosted sender serves **only external scripts** (verified live: `registerSW.js` + module bundle, no inline `<script>`). The inline rationale applies to the *offline single-file* build, not this page. → drop `'unsafe-inline'` from the hosted sender. | Med | v0.10.0 |
| **C1** | `cbor.ts` `decodeValue` recurses for arrays/maps with **no depth bound**. A deeply-nested hostile message deep-recurses. Today it is *caught* (`verifyAndComplete` → "Transfer failed"), but relies on catching a stack overflow — nondeterministic and slow. → explicit depth cap (~32; the real envelope nests ≤4). | Low (DoS, defense-in-depth) | v0.10.0 |
| **D3** | No supply-chain automation. Lockfile is committed, but there is no `npm audit` / Dependabot / OSV gate. Deps (`bc-ur`, `hash-wasm`, `jsqr`, `fflate`, `qrcode-generator`) run with full access to plaintext **and** passphrase — a poisoned dep is total compromise. → Dependabot + a CI audit step (gate at high/critical). | Med | v0.10.0 |
| **D1** | No passphrase-strength feedback. The KDF is strong, but the **human passphrase** is the weak link, and the QR animation is filmable → "harvest now, crack later." → a lightweight entropy nudge + filmable-screen reminder in the sender. Nudge, never block. | Med | v0.10.1 |
| **C2** | Trusted Types not enabled. The threat model is a **malicious sender** whose filename/mediaType reach the DOM. The receiver already uses `textContent` for all dynamic data, but nothing *enforces* it. → `require-trusted-types-for 'script'` + an explicit, greppable HTML policy so no future code path can open a string→sink hole. | Low (defense-in-depth) | v0.10.1 |
| **A3** | Cloudflare **Rocket Loader** is active on both pages (`/cdn-cgi/.../rocket-loader.min.js`), rewriting the app's module scripts and injecting edge JS into a crypto app's page — third-party code inside the trust boundary, and it makes the deployed page diverge from the audited source. → disable (operator). | Med | §5 checklist |
| **B** | Header-only protections GitHub Pages cannot set (a `<meta>` CSP cannot express `frame-ancestors`): clickjacking on Share/camera, referrer leakage, over-broad permissions. → set at the Cloudflare edge (operator). | Med | §5 checklist |
| **D2** | Argon2id is opt-in; PBKDF2-SHA-256 (default) is GPU/ASIC-friendly for offline brute-force of a filmed ciphertext. Argon2id (memory-hard) is already implemented and wire-compatible. → **separate decision** — flipping the default is a UX/perf trade-off (wasm load on every encrypted send). | — | Deferred (decision) |
| **E** | Honest, documented limits: encrypted transfers still leak *size + existence* (UI already says so); plaintext **"Verified" = anti-corruption, not anti-tamper** (an active malicious sender picks both bytes and hash — only AEAD is tamper-evident); no *sender authenticity* (signatures — see `docs/17`). | — | Docs / deferred |

## 3. Fixes in this plan

### v0.10.0 — core hardening (low UI risk)

**A1 — Receiver `connect-src 'none'`** (`web/vite-csp.ts`). The receiver window issues no network requests; the service worker's precache `fetch` runs in the worker context and is unaffected by the page `connect-src`. Result: "nothing leaves the device" is browser-enforced on **both** pages, not just the sender. Verified by the offline-PWA E2E (install → airplane mode → still loads).

**A2 — Sender drop `script-src 'unsafe-inline'`** (`web/vite-csp.ts`). Confirmed against the live page: the hosted sender loads only external scripts. Removing `'unsafe-inline'` brings the sender to parity with the receiver and closes an inline-script XSS avenue. (The offline single-file sender, `vite.config.sender.ts`, keeps its own inlined-asset CSP — untouched.)

**C1 — CBOR decode depth bound** (`web/src/core/cbor.ts`). Thread a `depth` argument through `decodeValue`; throw `CborError("nesting too deep")` past `MAX_CBOR_DEPTH = 32`. Deterministic, O(1) rejection instead of relying on a caught stack overflow. Regression test: a message of N nested single-element arrays rejects cleanly for N > 32 and still parses the real envelope (depth ≤ 4).

**D3 — Supply-chain gate.** `.github/dependabot.yml` (npm + github-actions ecosystems, weekly). A CI step `npm audit --audit-level=high` (in `web/`) that fails the build only on **high/critical** (moderate/low are noise for a browser-local, no-egress app and are triaged via Dependabot PRs, not a red build).

### v0.10.1 — passphrase UX + Trusted Types (UI-touching; own test cycle)

**D1 — Passphrase-strength nudge** (`web/src/ui/sender.ts`, sender only). When the passphrase field is non-empty, show a small inline indicator (weak / fair / strong) from a **dependency-free** estimate (length × character-class variety, with a short-passphrase warning), plus one honest line that the screen is filmable so a weak passphrase can be cracked from a recording. It **nudges, never blocks** — the user's choice is respected (additive; removes no existing behavior).

**C2 — Trusted Types** (`web/vite-csp.ts` receiver CSP + `web/src/ui/receiver.ts`). Add `require-trusted-types-for 'script'` to the receiver CSP and one explicit policy:

```
const BD = trustedTypes.createPolicy('bd', {
  createHTML: (s) => s,                 // inputs are compile-time-constant templates only
  createScriptURL: (u) => sameOriginOnly(u),
  // createScript omitted → any eval-like sink throws
});
```

Every `innerHTML = \`…static…\`` site is wrapped as `innerHTML = BD.createHTML(\`…\`)`. The guarantee is honest and real: **all dynamic (attacker-controlled) data already flows through `textContent`; the wrapped sites take only author-written literals; and with no default policy, any *stray* future `innerHTML = string` throws at runtime** — so a new code path cannot silently introduce an HTML/script sink. This is defense-in-depth layered on the existing discipline, not a replacement for it.

## 4. Non-goals / invariants

- **No wire, protocol, envelope, or crypto-primitive change.** Existing plaintext and encrypted transfers remain byte-compatible; the test vectors are untouched.
- **No feature removed or replaced.** Every change is additive or a tightening that preserves current behavior.
- **Sender and receiver stay one design language** — the passphrase indicator uses the shared token/dark-mode system.
- **D2 (Argon2id default) and the §5 Cloudflare items are out of this code batch** — recorded, not silently done.

## 5. Cloudflare operator checklist (cannot be done from the repo)

GitHub Pages serves the site (a `<meta>` CSP is our only in-repo lever); these need the Cloudflare edge, which is already in the request path:

1. **Disable Rocket Loader** (Speed → Optimization → Content Optimization) for the zone / a route rule on `grammy.jiang.is/blink-drop/*`. Removes edge-injected JS and script-tag rewriting (finding A3).
2. **Response-header Transform Rule** on the path:
   - `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY` (clickjacking — the meta CSP cannot express `frame-ancestors`).
   - `Referrer-Policy: no-referrer`.
   - `Permissions-Policy: camera=(self), geolocation=(), microphone=(), usb=(), payment=(), accelerometer=(), gyroscope=()` — only the receiver needs the camera.
   - (HSTS is already present.)

After applying, re-verify live with `curl -sI` + a fresh (SW-cleared) load.

## 6. Test plan

- **Unit** — new `cbor.ts` depth-bound test; full `vitest` suite stays green (currently 87).
- **Gates** — Biome clean, `tsc` clean, `vite build` + `build:sender` clean.
- **E2E, both viewports (desktop + iPhone 15 Pro Max, 390/430px), per the standing rule** — sender loads + plays under the tightened CSP; receiver scan→verify→share, encrypted (+ wrong-pass), and verify-failure via the synthetic-camera harness, all with **no CSP console violations**; passphrase indicator renders in light + dark. Finish by hard-refreshing past the service-worker cache to confirm the new build + CSP loaded.
- **Live** — after deploy, confirm the served `<meta>` CSP carries `connect-src 'none'` (receiver) and no `'unsafe-inline'` in the sender `script-src`; confirm no console CSP violations on a real load.

## 7. Tasks

- **T1** — `docs/19` (this document).
- **T2** — A1 + A2: tighten `web/vite-csp.ts` (receiver `connect-src 'none'`; sender drop `script-src 'unsafe-inline'`).
- **T3** — C1: `MAX_CBOR_DEPTH` + depth-threaded `decodeValue` in `web/src/core/cbor.ts`; `web/test/cbor-depth.test.ts`.
- **T4** — D3: `.github/dependabot.yml` + CI `npm audit --audit-level=high` step.
- **T5** — bump `web/package.json` → `0.10.0`, CHANGELOG, README; ship v0.10.0 (branch → PR → CI → merge → tag → release → deploy → verify live).
- **T6** — D1: passphrase-strength nudge in `web/src/ui/sender.ts` (+ styles); E2E both viewports.
- **T7** — C2: receiver Trusted Types (CSP directive + `bd` policy + wrap `innerHTML` sites); E2E, assert zero TT/CSP violations.
- **T8** — bump → `0.10.1`, CHANGELOG, README; ship v0.10.1.

## 8. Update log / reassessment (post-v0.10.0)

Recording what actually happened, so §2/§7 above read as the original plan and this
as the correction:

- **v0.10.0 shipped** (A1 receiver `connect-src 'none'`, A2 sender drops
  `script-src 'unsafe-inline'`, C1 CBOR depth bound, D3 supply-chain gate).
  Verified live: both pages serve `connect-src 'none'`; sender `script-src` has no
  `'unsafe-inline'`; 90 tests green.
- **D1 was already shipped in v0.4** (commit `472cb13`), not pending. `sender.ts`
  `updateStrength()` + `#strength` show a library-free entropy hint (weak/ok/strong)
  with an offline-attack tooltip; the send-time "Visible to anyone who can see the
  screen" caution already exists. Verified live. **No work needed.**
- **A3 (Rocket Loader) is disabled** on the live zone — verified: clean,
  un-rewritten script types, no `rocket-loader` tag, no `data-cf-settings`. The
  edge no longer injects/rewrites scripts.
- **C2 (Trusted Types) reassessed → deferred as redundant.** TT guards DOM
  script-sinks (`innerHTML`, `script.src`, `eval`, inline handlers), but the v0.10.0
  CSP (`script-src 'self'`, no `'unsafe-inline'`, no `'unsafe-eval'`) already
  neutralizes all of them, and every attacker-controlled value already flows through
  `textContent`, never `innerHTML`. Marginal security ≈ 0 against real complexity
  (wrapping ~10 sinks or a weak passthrough policy) + a latent Rocket-Loader
  conflict. Not worth shipping while the CSP stays strict.
- **B (Cloudflare response headers) — still open** (operator, §5): `frame-ancestors`/
  `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`.
- **D2 (Argon2id as the encryption default) — shipped in v0.10.1.** The sender's
  "Stronger key (Argon2id)" box now defaults to checked; unchecking opts down to
  PBKDF2. Minimal approach — the core API default is unchanged (PBKDF2); the sender
  passes `kdf: "argon2id"` explicitly. Wire-compatible (the receiver already reads
  both KDFs); test vectors pin the KDF, so none changed. Trade-off: a lazy wasm
  load + slower KDF on every encrypted send (accepted).

## 9. CI / pre-commit hardening (v0.10.0 follow-up)

Supply-chain + gate hardening for the toolchain itself (extends D3):

**GitHub Actions**
- **All actions pinned to a full commit SHA** (with a `# vX` comment) across
  `ci.yml`, `pages.yml`, `codeql.yml` — a hijacked mutable tag can no longer inject
  CI code. Dependabot (`github-actions` ecosystem) keeps the SHAs current.
- **Build + CSP-invariant gate** in the `web` job: CI now runs `npm run build` and
  `build:sender` (a broken build previously passed CI, caught only at deploy) and
  asserts the no-egress CSP survives the build — `connect-src 'none'` on both hosted
  pages, no `'unsafe-inline'` in the hosted sender, and the offline sender still
  carries it. A CSP regression fails CI.
- **CodeQL** SAST workflow (`javascript-typescript`, `security-and-quality`), on
  push/PR/weekly.
- **`dependency-review-action`** on PRs — blocks a PR that introduces a
  high-severity or disallowed-license dependency (repo Dependency Graph enabled
  2026-07-08). Layers on top of npm audit + Dependabot + pinned SHAs.
- **Least privilege + hygiene** — read-only default `permissions`, per-job
  `security-events: write` only for CodeQL; `concurrency: cancel-in-progress` and
  `timeout-minutes` on every job.

**pre-commit**
- **`gitleaks`** (broad secret scanning) + **`detect-private-key`** — prevent
  committing credentials.
- **`actionlint`** — lint the workflow YAML.
- **`web-test` moved to the `pre-push` stage** — commits stay fast; the vitest suite
  gates on push. Enable with
  `pre-commit install --hook-type pre-commit --hook-type pre-push`.

Validated locally: `actionlint`, `gitleaks`, `detect-private-key`, `check-yaml` all
pass; the CSP-invariant script passes against a fresh build.
