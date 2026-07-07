// Bundle verified files into a single .zip for iOS-reliable multi-file delivery
// (docs/14). iOS Files saves + unzips one archive cleanly, where multi-file Web
// Share / sequential downloads are unreliable. fflate is pure JS (no wasm/blob)
// and receiver-only, so it never touches the single-file offline sender.
import { zipSync } from "fflate";

// Duplicate filenames are de-duplicated (`name (2).ext`) so no file is dropped —
// a zip can't hold two entries with the same key.
export function zipFiles(files: { name: string; bytes: Uint8Array }[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const f of files) {
    let name = f.name || "file";
    if (used.has(name)) {
      const dot = name.lastIndexOf(".");
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      let n = 2;
      while (used.has(`${base} (${n})${ext}`)) n++;
      name = `${base} (${n})${ext}`;
    }
    used.add(name);
    entries[name] = f.bytes;
  }
  return zipSync(entries);
}
