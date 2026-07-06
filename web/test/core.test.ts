import { describe, expect, it } from "vitest";
import {
  Assembler,
  buildMessage,
  bytesEqual,
  type CborMap,
  cborDecode,
  cborEncode,
  DecompressionOverflowError,
  DigestMismatchError,
  decodeQrPartsToFile,
  encodeFileToQrParts,
  type FileInput,
  gunzip,
  gzip,
  MalformedMessageError,
  openMessage,
  parseMessage,
  qrPartStream,
  sha256,
  systematicQrParts,
} from "../src/core/index.js";

// Deterministic, poorly-compressible bytes so messages span many fragments.
function pseudoBytes(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0; // LCG
    out[i] = (s >>> 24) & 0xff;
  }
  return out;
}

function textInput(name: string, text: string): FileInput {
  return { bytes: new TextEncoder().encode(text), name, mediaType: "text/plain" };
}

describe("cbor (message envelope subset)", () => {
  it("round-trips uint / tstr / bstr / array / map", () => {
    const value: CborMap = new Map<number, any>([
      [1, "config.yaml"],
      [2, "application/yaml"],
      [3, 123456],
      [4, new Uint8Array([1, 2, 3, 255, 0])],
      [5, 1],
    ]);
    const message = [value, new Uint8Array([9, 8, 7])];
    const round = cborDecode(cborEncode(message as any));
    expect(round).toEqual(message);
  });

  it("encodes map keys in canonical (ascending) order regardless of insertion order", () => {
    const a = new Map<number, any>([
      [5, 0],
      [1, "x"],
      [3, 9],
    ]);
    const b = new Map<number, any>([
      [1, "x"],
      [3, 9],
      [5, 0],
    ]);
    expect(cborEncode(a as any)).toEqual(cborEncode(b as any));
  });

  it("rejects trailing bytes and malformed input (SG-5, strict boundary)", () => {
    const good = cborEncode(42 as any);
    const withTrailing = new Uint8Array([...good, 0x00]);
    expect(() => cborDecode(withTrailing)).toThrow();
    expect(() => cborDecode(new Uint8Array([0x9f]))).toThrow(); // indefinite-length array head
  });
});

describe("gzip / gunzip (bounded)", () => {
  it("round-trips", async () => {
    const data = pseudoBytes(5000, 7);
    const back = await gunzip(await gzip(data), data.length);
    expect(bytesEqual(back, data)).toBe(true);
  });

  it("refuses to inflate past the ceiling (SG-2 decompression bomb)", async () => {
    const zeros = new Uint8Array(200_000); // compresses tiny, inflates large
    const compressed = await gzip(zeros);
    expect(compressed.length).toBeLessThan(zeros.length);
    await expect(gunzip(compressed, 1000)).rejects.toBeInstanceOf(DecompressionOverflowError);
  });
});

describe("envelope", () => {
  it("build -> open round-trips and preserves the header", async () => {
    const input = textInput("hello.txt", "hello blink-drop ".repeat(20));
    const decoded = await openMessage(await buildMessage(input));
    expect(bytesEqual(decoded.bytes, input.bytes)).toBe(true);
    expect(decoded.header.name).toBe("hello.txt");
    expect(decoded.header.mediaType).toBe("text/plain");
    expect(decoded.header.origSize).toBe(input.bytes.length);
    expect(bytesEqual(decoded.header.sha256, await sha256(input.bytes))).toBe(true);
  });

  it("stores uncompressed when gzip would not shrink (compression=0 path)", async () => {
    const input: FileInput = { bytes: pseudoBytes(48, 3), name: "r.bin", mediaType: "application/octet-stream" };
    const { header, payload } = parseMessage(await buildMessage(input));
    expect(header.compression).toBe(0);
    expect(bytesEqual(payload, input.bytes)).toBe(true);
    const decoded = await openMessage(await buildMessage(input));
    expect(bytesEqual(decoded.bytes, input.bytes)).toBe(true);
  });

  it("rejects a tampered file with a loud digest mismatch, returning nothing (SG-1)", async () => {
    // Use the compression=0 path so a flipped payload byte survives to the digest check.
    const input: FileInput = { bytes: pseudoBytes(48, 5), name: "r.bin", mediaType: "application/octet-stream" };
    const message = await buildMessage(input);
    const [header, payload] = cborDecode(message) as [CborMap, Uint8Array];
    const tampered = new Uint8Array(payload);
    tampered[0] = tampered[0]! ^ 0xff;
    const badMessage = cborEncode([header, tampered] as any);
    await expect(openMessage(badMessage)).rejects.toBeInstanceOf(DigestMismatchError);
  });

  it("rejects a decompression bomb whose header lies about orig_size (SG-2)", async () => {
    const zeros = new Uint8Array(200_000);
    const compressed = await gzip(zeros);
    const lyingHeader: CborMap = new Map<number, any>([
      [1, "bomb.bin"],
      [2, "application/octet-stream"],
      [3, 100], // LIE: claims 100 bytes
      [4, await sha256(zeros)],
      [5, 1], // gzip
    ]);
    const bombMessage = cborEncode([lyingHeader, compressed] as any);
    await expect(openMessage(bombMessage)).rejects.toBeInstanceOf(DecompressionOverflowError);
  });

  it("rejects structurally malformed messages", async () => {
    await expect(async () => parseMessage(new Uint8Array([0x01, 0x02, 0x03]))).rejects.toBeInstanceOf(
      MalformedMessageError,
    );
  });
});

describe("UR transport + full protocol round-trip (E2E-1)", () => {
  it("uses the blink-drop UR type and uppercases for QR", async () => {
    const parts = await encodeFileToQrParts(textInput("a.txt", "small"));
    expect(parts.length).toBeGreaterThanOrEqual(1);
    expect(parts[0]).toMatch(/^UR:BLINK-DROP\//);
  });

  it("round-trips a file through systematic parts (in order)", async () => {
    const input = textInput("note.txt", "the quick brown fox ".repeat(50));
    const parts = await encodeFileToQrParts(input);
    const decoded = await decodeQrPartsToFile(parts);
    expect(bytesEqual(decoded.bytes, input.bytes)).toBe(true);
    expect(bytesEqual(decoded.header.sha256, await sha256(input.bytes))).toBe(true);
  });

  it("reconstructs from an out-of-order, lossy subset of fountain parts (R-SUBSET / S3)", async () => {
    const input: FileInput = { bytes: pseudoBytes(3000, 11), name: "blob.bin", mediaType: "application/octet-stream" };
    const message = await buildMessage(input);
    const frag = 200;
    const seqLen = systematicQrParts(message, frag).length;
    expect(seqLen).toBeGreaterThan(8); // genuinely multi-fragment

    // Generate a generous fountain stream, drop ~20%, shuffle deterministically.
    const stream = qrPartStream(message, seqLen * 3, frag);
    const kept = stream.filter((_, i) => i % 5 !== 0); // drop every 5th
    const shuffled = kept
      .map((p, i) => ({ p, k: (i * 2654435761) >>> 0 }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.p);

    const asm = new Assembler();
    for (const part of shuffled) {
      asm.receiveQr(part);
      if (asm.isComplete) break;
    }
    expect(asm.isSuccess).toBe(true);
    const decoded = await openMessage(asm.message());
    expect(bytesEqual(decoded.bytes, input.bytes)).toBe(true);
  });

  it("ignores duplicate captures (R-DEDUPE)", async () => {
    const input = textInput("dup.txt", "duplicate me ".repeat(40));
    const message = await buildMessage(input);
    const parts = systematicQrParts(message, 80);
    const asm = new Assembler();
    for (const part of parts) {
      asm.receiveQr(part);
      asm.receiveQr(part); // same frame seen twice
      asm.receiveQr(part);
    }
    expect(asm.isSuccess).toBe(true);
    expect(bytesEqual((await openMessage(asm.message())).bytes, input.bytes)).toBe(true);
  });
});
