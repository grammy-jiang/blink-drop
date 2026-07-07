import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildMessage,
  decodeQrPartsToFile,
  encodeFileToQrParts,
  type FileInput,
  sha256,
  systematicQrParts,
} from "../src/core/index.js";

const VECTORS = new URL("../../shared/test-vectors/", import.meta.url);

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function fromHex(s: string): Uint8Array {
  const clean = s.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
async function readText(rel: string): Promise<string> {
  return readFile(new URL(rel, VECTORS), "utf-8");
}
async function readBin(rel: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(new URL(rel, VECTORS)));
}

const FRAMING = ["vec-01-hello", "vec-02-multi", "vec-06-multifile"];
const ROUNDTRIP = ["vec-01-hello", "vec-02-binary", "vec-03-incompressible"];

// Tier 1 — deterministic, byte-exact. The core must emit exactly the committed
// UR parts from the committed canonical message. This is what a future Swift
// implementation must also satisfy.
describe("test vectors — tier 1 (framing, byte-exact)", () => {
  for (const name of FRAMING) {
    it(`framing/${name}: systematic parts match parts.txt`, async () => {
      const message = fromHex(await readText(`framing/${name}/message.cbor.hex`));
      const params = JSON.parse(await readText(`framing/${name}/params.json`)) as { maxFragmentLength: number };
      const expected = (await readText(`framing/${name}/parts.txt`)).split("\n").filter((l) => l.length > 0);
      const actual = systematicQrParts(message, params.maxFragmentLength);
      expect(actual).toEqual(expected);
    });
  }
});

// Tier 1 (encrypted) — the encrypted envelope is byte-exact and reproducible
// from pinned salt+nonce+passphrase+iterations. A future Swift impl must emit the
// identical message.cbor.hex and parts.txt (docs/07 §6).
describe("test vectors — tier 1 (encrypted framing, byte-exact)", () => {
  it("framing/vec-04-encrypted: rebuilds the exact encrypted message + parts, and decrypts back", async () => {
    const name = "vec-04-encrypted";
    const p = JSON.parse(await readText(`framing/${name}/params.json`)) as {
      maxFragmentLength: number;
      iterations: number;
      saltHex: string;
      nonceHex: string;
      passphrase: string;
      plaintextHex: string;
      name: string;
      mediaType: string;
    };
    const input: FileInput = { bytes: fromHex(p.plaintextHex), name: p.name, mediaType: p.mediaType };
    const opts = {
      passphrase: p.passphrase,
      salt: fromHex(p.saltHex),
      nonce: fromHex(p.nonceHex),
      iterations: p.iterations,
    };

    const message = await buildMessage(input, opts);
    expect(hex(message)).toBe((await readText(`framing/${name}/message.cbor.hex`)).trim());

    const expectedParts = (await readText(`framing/${name}/parts.txt`)).split("\n").filter((l) => l.length > 0);
    expect(systematicQrParts(message, p.maxFragmentLength)).toEqual(expectedParts);

    // And the pinned stream decrypts back to the original under the passphrase.
    const parts = await encodeFileToQrParts(input, p.maxFragmentLength, opts);
    const decoded = await decodeQrPartsToFile(parts, { passphrase: p.passphrase });
    expect(hex(await sha256(decoded.bytes))).toBe(hex(await sha256(input.bytes)));
  });

  it("framing/vec-05-encrypted-argon2: rebuilds the exact argon2id message + parts, and decrypts back", async () => {
    const name = "vec-05-encrypted-argon2";
    const p = JSON.parse(await readText(`framing/${name}/params.json`)) as {
      maxFragmentLength: number;
      argon: { m: number; t: number; p: number };
      saltHex: string;
      nonceHex: string;
      passphrase: string;
      plaintextHex: string;
      name: string;
      mediaType: string;
    };
    const input: FileInput = { bytes: fromHex(p.plaintextHex), name: p.name, mediaType: p.mediaType };
    const opts = {
      passphrase: p.passphrase,
      kdf: "argon2id" as const,
      argon: p.argon,
      salt: fromHex(p.saltHex),
      nonce: fromHex(p.nonceHex),
    };

    const message = await buildMessage(input, opts);
    expect(hex(message)).toBe((await readText(`framing/${name}/message.cbor.hex`)).trim());

    const expectedParts = (await readText(`framing/${name}/parts.txt`)).split("\n").filter((l) => l.length > 0);
    expect(systematicQrParts(message, p.maxFragmentLength)).toEqual(expectedParts);

    const parts = await encodeFileToQrParts(input, p.maxFragmentLength, opts);
    const decoded = await decodeQrPartsToFile(parts, { passphrase: p.passphrase });
    expect(hex(await sha256(decoded.bytes))).toBe(hex(await sha256(input.bytes)));
  });
});

// Tier 2 — end-to-end. Encode the original with our own gzip and recover bytes
// whose SHA-256 matches the committed digest (gzip output is not constrained).
describe("test vectors — tier 2 (roundtrip, digest-exact)", () => {
  for (const name of ROUNDTRIP) {
    it(`roundtrip/${name}: encode -> decode preserves the file`, async () => {
      const bytes = await readBin(`roundtrip/${name}/input.bin`);
      const meta = JSON.parse(await readText(`roundtrip/${name}/meta.json`)) as {
        name: string;
        mediaType: string;
        origSize: number;
        sha256: string;
      };
      expect(hex(await sha256(bytes))).toBe(meta.sha256);

      const input: FileInput = { bytes, name: meta.name, mediaType: meta.mediaType };
      const decoded = await decodeQrPartsToFile(await encodeFileToQrParts(input));
      expect(decoded.bytes.length).toBe(meta.origSize);
      expect(hex(decoded.header.sha256)).toBe(meta.sha256);
      expect(hex(await sha256(decoded.bytes))).toBe(meta.sha256);
    });
  }
});
