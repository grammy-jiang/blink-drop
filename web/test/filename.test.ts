import { describe, expect, it } from "vitest";
import { safeName } from "../src/receiver/filename.js";

const BEL = String.fromCharCode(7);
const NUL = String.fromCharCode(0);
const DEL = String.fromCharCode(0x7f);

describe("safeName — untrusted filename hardening (docs/16 Fix A)", () => {
  it("passes normal filenames through unchanged", () => {
    expect(safeName("report.txt")).toBe("report.txt");
    expect(safeName("notes.md")).toBe("notes.md");
    expect(safeName("data-2026.csv")).toBe("data-2026.csv");
  });

  it("strips path components (traversal / zip-slip)", () => {
    expect(safeName("../../secret.txt")).toBe("secret.txt");
    expect(safeName("../../../../etc/passwd")).toBe("passwd");
    expect(safeName("/absolute/path/x.pdf")).toBe("x.pdf");
    expect(safeName("a\\b\\c\\evil.exe")).toBe("evil.exe");
    expect(safeName("..\\..\\win.dll")).toBe("win.dll");
  });

  it("reduces pure-traversal / empty residue to a safe fallback", () => {
    expect(safeName("..")).toBe("file");
    expect(safeName(".")).toBe("file");
    expect(safeName("../../")).toBe("file");
    expect(safeName("")).toBe("file");
    expect(safeName("...")).toBe("file"); // all dots trimmed → empty → fallback
  });

  it("strips control characters", () => {
    expect(safeName(`re${BEL}port.txt`)).toBe("report.txt");
    expect(safeName(`abc${NUL}.bin`)).toBe("abc.bin");
    expect(safeName("line\nbreak.txt")).toBe("linebreak.txt");
    expect(safeName(`tab\tx${DEL}.txt`)).toBe("tabx.txt");
  });

  it("trims leading dots (no hidden files) and trailing dots/space", () => {
    expect(safeName(".hidden")).toBe("hidden");
    expect(safeName(".env")).toBe("env");
    expect(safeName("report.pdf ")).toBe("report.pdf");
    expect(safeName("report.pdf.")).toBe("report.pdf");
  });

  it("is idempotent", () => {
    for (const n of ["../../x", ".hidden", "a b", "..", "normal.txt", `x${BEL}y`]) {
      expect(safeName(safeName(n))).toBe(safeName(n));
    }
  });

  it("caps length, preserving a short extension", () => {
    const long = `${"a".repeat(500)}.pdf`;
    const out = safeName(long);
    expect(out.length).toBe(200);
    expect(out.endsWith(".pdf")).toBe(true);
  });

  it("caps length without a spurious extension when none is real", () => {
    const out = safeName("b".repeat(500));
    expect(out.length).toBe(200);
    expect(out).toBe("b".repeat(200));
  });

  it("normalizes Unicode to NFC", () => {
    // "e" + combining acute (NFD) collapses to the single NFC codepoint "é"
    const nfd = `caf${String.fromCharCode(0x65, 0x301)}.txt`;
    expect(safeName(nfd)).toBe("café.txt");
    expect(safeName(nfd).normalize("NFC")).toBe(safeName(nfd));
  });
});
