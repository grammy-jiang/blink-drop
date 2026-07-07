import { describe, expect, it } from "vitest";
import {
  buildMessage,
  bytesEqual,
  decodeQrPartsToFile,
  encodeFileToQrParts,
  type FileInput,
  isEncryptedMessage,
  openMessage,
  parseMessage,
  qrPartStream,
  systematicQrParts,
  WrongPassphraseError,
} from "../src/core/index.js";

// Small PBKDF2 work factor so the suite stays fast; production uses 600k.
const ITER = 2048;
const PASS = "edge-case passphrase";

function pseudoBytes(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = (s >>> 24) & 0xff;
  }
  return out;
}

// Round-trip through BOTH the plaintext and encrypted envelopes; assert the bytes
// and the metadata (name, media type) survive intact on each.
async function bothPaths(input: FileInput): Promise<void> {
  const p = await openMessage(await buildMessage(input));
  expect(bytesEqual(p.bytes, input.bytes)).toBe(true);
  expect(p.header.name).toBe(input.name);
  expect(p.header.mediaType).toBe(input.mediaType);

  const msg = await buildMessage(input, { passphrase: PASS, iterations: ITER });
  expect(isEncryptedMessage(msg)).toBe(true);
  const e = await openMessage(msg, { passphrase: PASS });
  expect(bytesEqual(e.bytes, input.bytes)).toBe(true);
  expect(e.header.name).toBe(input.name);
  expect(e.header.mediaType).toBe(input.mediaType);
}

describe("edge cases — envelope (plaintext + encrypted)", () => {
  it("empty file (0 bytes)", async () => {
    await bothPaths({ bytes: new Uint8Array(0), name: "empty.txt", mediaType: "text/plain" });
  });

  it("single byte", async () => {
    await bothPaths({ bytes: new Uint8Array([0x42]), name: "one.bin", mediaType: "application/octet-stream" });
  });

  it("all 256 byte values (non-UTF-8 binary)", async () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    await bothPaths({ bytes, name: "bytes.bin", mediaType: "application/octet-stream" });
  });

  it("unicode / emoji / very long filename and an empty media type", async () => {
    const name = `文件-\u{1F512}-café-${"x".repeat(200)}.txt`;
    await bothPaths({ bytes: new TextEncoder().encode("payload"), name, mediaType: "" });
  });

  it("incompressible ~64 KB uses the compression=0 path and round-trips both ways", async () => {
    const input: FileInput = { bytes: pseudoBytes(64 * 1024, 3), name: "r.bin", mediaType: "application/octet-stream" };
    expect(parseMessage(await buildMessage(input)).header.compression).toBe(0);
    await bothPaths(input);
  });

  it("highly compressible ~200 KB (gzip path) round-trips both ways", async () => {
    const input: FileInput = {
      bytes: new Uint8Array(200 * 1024),
      name: "zeros.bin",
      mediaType: "application/octet-stream",
    };
    expect(parseMessage(await buildMessage(input)).header.compression).toBe(1);
    await bothPaths(input);
  });

  it("empty passphrase is treated as plaintext, not encrypted", async () => {
    const input: FileInput = { bytes: new TextEncoder().encode("hello"), name: "h.txt", mediaType: "text/plain" };
    const msg = await buildMessage(input, { passphrase: "" });
    expect(isEncryptedMessage(msg)).toBe(false);
    expect(bytesEqual((await openMessage(msg)).bytes, input.bytes)).toBe(true);
  });
});

describe("edge cases — QR framing / reconstruction", () => {
  it("empty file survives QR encode/decode (plaintext + encrypted)", async () => {
    const input: FileInput = { bytes: new Uint8Array(0), name: "e.txt", mediaType: "text/plain" };
    const plain = await decodeQrPartsToFile(await encodeFileToQrParts(input));
    expect(bytesEqual(plain.bytes, input.bytes)).toBe(true);
    const parts = await encodeFileToQrParts(input, 600, { passphrase: PASS, iterations: ITER });
    const enc = await decodeQrPartsToFile(parts, { passphrase: PASS });
    expect(bytesEqual(enc.bytes, input.bytes)).toBe(true);
  });

  it("many-fragment encrypted file reconstructs from a lossy, shuffled fountain subset", async () => {
    const input: FileInput = {
      bytes: pseudoBytes(64 * 1024, 11),
      name: "big.bin",
      mediaType: "application/octet-stream",
    };
    const message = await buildMessage(input, { passphrase: PASS, iterations: ITER });
    const frag = 400;
    const seqLen = systematicQrParts(message, frag).length;
    expect(seqLen).toBeGreaterThan(50); // genuinely many-fragment

    const stream = qrPartStream(message, seqLen * 3, frag);
    const kept = stream.filter((_, i) => i % 5 !== 0); // drop ~20%
    const shuffled = kept
      .map((p, i) => ({ p, k: (i * 2654435761) >>> 0 }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.p);

    const decoded = await decodeQrPartsToFile(shuffled, { passphrase: PASS });
    expect(bytesEqual(decoded.bytes, input.bytes)).toBe(true);
  });

  it("wrong passphrase on a many-fragment encrypted transfer fails closed after full assembly", async () => {
    const input: FileInput = { bytes: pseudoBytes(32 * 1024, 7), name: "s.bin", mediaType: "application/octet-stream" };
    const parts = await encodeFileToQrParts(input, 400, { passphrase: PASS, iterations: ITER });
    await expect(decodeQrPartsToFile(parts, { passphrase: "nope" })).rejects.toBeInstanceOf(WrongPassphraseError);
  });
});
