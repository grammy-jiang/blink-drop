// Generates shared/test-vectors — the executable cross-language protocol
// contract (docs/01-protocol.md §10). Run once and commit the output:
//   npm run gen:vectors
//
// Two tiers:
//   framing/   — deterministic, byte-exact. Stores a CANONICAL message (its
//                gzip is captured, not regenerated) so the UR parts are fully
//                reproducible; both TS and Swift must emit identical parts.txt.
//   roundtrip/ — end-to-end. Stores the original input + its SHA-256; each side
//                encodes with its own gzip (bytes may differ) and must recover
//                bytes whose digest matches (gzip treated as opaque).

import { mkdir, writeFile } from "node:fs/promises";
import type { FileInput } from "../src/core/index.js";
import { buildMessage, sha256, systematicQrParts } from "../src/core/index.js";

const ROOT = new URL("../../shared/test-vectors/", import.meta.url);

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Deterministic, poorly-compressible bytes (LCG) — no Math.random.
function pseudoBytes(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = (s >>> 24) & 0xff;
  }
  return out;
}

async function outDir(...parts: string[]): Promise<URL> {
  const dir = new URL(`${parts.join("/")}/`, ROOT);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function framingVector(name: string, input: FileInput, maxFragmentLength: number): Promise<void> {
  const message = await buildMessage(input);
  const parts = systematicQrParts(message, maxFragmentLength);
  const dir = await outDir("framing", name);
  await writeFile(new URL("message.cbor.hex", dir), `${hex(message)}\n`);
  await writeFile(new URL("parts.txt", dir), `${parts.join("\n")}\n`);
  await writeFile(
    new URL("params.json", dir),
    `${JSON.stringify(
      { urType: "blink-drop", maxFragmentLength, seqLen: parts.length, name: input.name, mediaType: input.mediaType },
      null,
      2,
    )}\n`,
  );
  console.log(`framing/${name}: ${parts.length} part(s), message ${message.length}B`);
}

async function roundtripVector(name: string, input: FileInput): Promise<void> {
  const dir = await outDir("roundtrip", name);
  await writeFile(new URL("input.bin", dir), input.bytes);
  await writeFile(
    new URL("meta.json", dir),
    `${JSON.stringify(
      {
        name: input.name,
        mediaType: input.mediaType,
        origSize: input.bytes.length,
        sha256: hex(await sha256(input.bytes)),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`roundtrip/${name}: ${input.bytes.length}B`);
}

const helloText = "Blink-Drop test vector — the quick brown fox jumps over the lazy dog.\n".repeat(4);
const inputs = {
  hello: { bytes: new TextEncoder().encode(helloText), name: "hello.txt", mediaType: "text/plain" },
  multi: { bytes: pseudoBytes(3000, 11), name: "blob.bin", mediaType: "application/octet-stream" },
  binary: { bytes: pseudoBytes(500, 23), name: "data.bin", mediaType: "application/octet-stream" },
  incompressible: { bytes: pseudoBytes(40, 5), name: "tiny.bin", mediaType: "application/octet-stream" },
} satisfies Record<string, FileInput>;

await framingVector("vec-01-hello", inputs.hello, 600);
await framingVector("vec-02-multi", inputs.multi, 200);
await roundtripVector("vec-01-hello", inputs.hello);
await roundtripVector("vec-02-binary", inputs.binary);
await roundtripVector("vec-03-incompressible", inputs.incompressible);

console.log("done → shared/test-vectors/");
