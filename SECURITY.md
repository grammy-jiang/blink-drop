# Security Policy

## Supported versions

Blink-Drop ships continuously from `main`; only the **latest release** is
supported. There are no long-term support branches.

| Version | Supported |
| ------- | --------- |
| latest release (`main`) | ✅ |
| older tags | ❌ |

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue or PR
for a suspected vulnerability.

- Preferred: open a private report at
  https://github.com/grammy-jiang/blink-drop/security/advisories/new
  (GitHub → the repository's **Security** tab → **Report a vulnerability**,
  i.e. GitHub Private Vulnerability Reporting).
- Include: affected version/commit, a description, and a minimal reproduction if
  you have one.

You can expect an acknowledgement within a few days. Because this is a small
volunteer-maintained project, please allow reasonable time for a fix before any
public disclosure (coordinated disclosure).

## Scope and threat model

Blink-Drop transfers small files between two nearby screens as animated QR codes.
Its design is **offline-first**: both pages are served with a Content-Security-
Policy of `connect-src 'none'` (no network egress), files are processed on-device
and never uploaded, and an optional passphrase encrypts the payload
(AES-GCM, Argon2id by default).

Especially relevant reports:

- Ways to make the receiver accept a file that fails its SHA-256 verification.
- Ways to defeat or downgrade the passphrase encryption / KDF.
- Any network egress from either page (a CSP bypass), or exfiltration of the
  plaintext or passphrase.
- Resource-exhaustion (DoS) reachable from a single crafted QR frame.

Out of scope: the confidentiality of *metadata* (a passphrase hides the file
name and content, but not its size or that a transfer happened — this is stated
in the UI), and issues that require a compromised device or physical access to
the unlocked screen.
