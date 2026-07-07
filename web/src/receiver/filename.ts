// Turn an untrusted, sender-controlled filename (protocol §4 `name`) into one
// safe to hand to the OS share sheet, a download, or a zip entry key. The file
// BYTES are already SHA-256-verified (SG-1) — only the NAME is untrusted here,
// and it flows into filesystem/OS contexts (a `.zip` entry could otherwise
// zip-slip; a download name could carry path/control chars). This is a
// receiver-side delivery guard; the protocol/core keep the raw metadata.
//
// Idempotent: safeName(safeName(x)) === safeName(x), so applying it at several
// boundaries is harmless defense-in-depth.

const MAX_NAME_LEN = 200; // well under the 255-byte filesystem limit
const MAX_EXT_LEN = 16; // only preserve a plausibly-real extension when truncating

// Strip C0 control characters (U+0000–U+001F) and DEL (U+007F). Done by code
// point rather than a control-char regex literal — clearer, and avoids embedding
// raw control bytes in source.
function stripControls(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c > 0x1f && c !== 0x7f) out += ch;
  }
  return out;
}

export function safeName(raw: string): string {
  // Normalize first so composed/decomposed forms compare predictably.
  let name = (raw ?? "").normalize("NFC");
  // Basename only: drop every directory component. Kills `../`, absolute paths,
  // and zip-slip (`../../evil`) — a zip entry can never escape its folder.
  const segments = name.split(/[/\\]/);
  name = segments[segments.length - 1] ?? "";
  // Strip C0 control characters and DEL.
  name = stripControls(name);
  // Trim leading/trailing dots and whitespace: no hidden-file (`.evil`),
  // no trailing-dot/space tricks (Windows silently strips those).
  name = name.replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");
  // Pure-traversal or empty residue → a safe fallback.
  if (name === "" || name === "." || name === "..") return "file";
  // Length cap, preserving a short trailing extension when there is one.
  if (name.length > MAX_NAME_LEN) {
    const dot = name.lastIndexOf(".");
    const extLen = name.length - dot;
    if (dot > 0 && extLen <= MAX_EXT_LEN) {
      name = name.slice(0, MAX_NAME_LEN - extLen) + name.slice(dot);
    } else {
      name = name.slice(0, MAX_NAME_LEN);
    }
  }
  return name;
}
