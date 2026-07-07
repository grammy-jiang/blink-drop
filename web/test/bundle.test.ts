import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { bytesEqual } from "../src/core/index.js";
import { zipFiles } from "../src/receiver/bundle.js";

const enc = new TextEncoder();

describe("zipFiles — multi-file .zip bundle (docs/14)", () => {
  it("produces a valid zip that round-trips every file", () => {
    const files = [
      { name: "a.txt", bytes: enc.encode("alpha") },
      { name: "b.bin", bytes: new Uint8Array([0, 1, 2, 255, 42]) },
    ];
    const zip = zipFiles(files);
    // PK zip signature
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    const back = unzipSync(zip);
    expect(bytesEqual(back["a.txt"]!, files[0]!.bytes)).toBe(true);
    expect(bytesEqual(back["b.bin"]!, files[1]!.bytes)).toBe(true);
  });

  it("sanitizes traversal filenames into safe basenames (no zip-slip)", () => {
    const zip = zipFiles([
      { name: "../../../../etc/evil.sh", bytes: enc.encode("x") },
      { name: "a\\b\\win.dll", bytes: enc.encode("y") },
    ]);
    const names = Object.keys(unzipSync(zip));
    expect(names).toContain("evil.sh");
    expect(names).toContain("win.dll");
    // no entry key retains a path separator
    expect(names.every((n) => !n.includes("/") && !n.includes("\\"))).toBe(true);
  });

  it("de-duplicates colliding filenames so none is dropped", () => {
    const zip = zipFiles([
      { name: "dup.txt", bytes: enc.encode("first") },
      { name: "dup.txt", bytes: enc.encode("second") },
    ]);
    const back = unzipSync(zip);
    const names = Object.keys(back);
    expect(names.length).toBe(2);
    expect(names).toContain("dup.txt");
    expect(names).toContain("dup (2).txt");
  });
});
