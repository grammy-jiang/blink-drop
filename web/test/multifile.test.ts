import { describe, expect, it } from "vitest";
import {
  buildFilesMessage,
  buildMessage,
  bytesEqual,
  type CborMap,
  cborDecode,
  cborEncode,
  DigestMismatchError,
  decodeQrPartsToFiles,
  encodeFilesToQrParts,
  type FileInput,
  isEncryptedMessage,
  MAX_FILE_COUNT,
  MalformedMessageError,
  openFilesMessage,
  openMessage,
} from "../src/core/index.js";

const PASS = "multi passphrase";
const ITER = 2048;

function textInput(name: string, text: string): FileInput {
  return { bytes: new TextEncoder().encode(text), name, mediaType: "text/plain" };
}
function pseudoBytes(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = (s >>> 24) & 0xff;
  }
  return out;
}
async function sameFile(got: { header: { name: string }; bytes: Uint8Array }, want: FileInput): Promise<void> {
  expect(got.header.name).toBe(want.name);
  expect(bytesEqual(got.bytes, want.bytes)).toBe(true);
}

const A = textInput("a.txt", "alpha ".repeat(20));
const B = textInput("b.txt", "bravo ".repeat(30));
const C: FileInput = { bytes: pseudoBytes(64, 7), name: "c.bin", mediaType: "application/octet-stream" };

describe("multi-file envelope (docs/13, protocol §4.2)", () => {
  it("2-file plaintext round-trips, each verified", async () => {
    const files = await openFilesMessage(await buildFilesMessage([A, B]));
    expect(files.length).toBe(2);
    await sameFile(files[0]!, A);
    await sameFile(files[1]!, B);
  });

  it("3-file encrypted round-trips (metadata sealed)", async () => {
    const msg = await buildFilesMessage([A, B, C], { passphrase: PASS, iterations: ITER });
    expect(isEncryptedMessage(msg)).toBe(true);
    // Individual file names must NOT be in the ciphertext.
    expect(new TextDecoder().decode(msg).includes("a.txt")).toBe(false);
    const files = await openFilesMessage(msg, { passphrase: PASS });
    expect(files.length).toBe(3);
    await sameFile(files[2]!, C);
  });

  it("a single file via buildFilesMessage is byte-identical to buildMessage (wire unchanged)", async () => {
    const one = await buildFilesMessage([A]);
    const legacy = await buildMessage(A);
    expect(bytesEqual(one, legacy)).toBe(true);
    // and opens as one file
    expect((await openFilesMessage(one)).length).toBe(1);
  });

  it("round-trips through QR parts", async () => {
    const files = await decodeQrPartsToFiles(await encodeFilesToQrParts([A, B, C], 200));
    expect(files.map((f) => f.header.name)).toEqual(["a.txt", "b.txt", "c.bin"]);
  });

  it("one tampered file in the set fails the whole open (per-file SHA-256 gate)", async () => {
    const msg = await buildFilesMessage([A, C]); // C is incompressible → a flipped payload byte survives to the digest
    const [manifest, entries] = cborDecode(msg) as [CborMap, unknown[]];
    void manifest;
    const payload = (entries[1] as unknown[])[1] as Uint8Array; // C's payload
    payload[0] = payload[0]! ^ 0xff;
    const bad = cborEncode([manifest, entries] as never);
    await expect(openFilesMessage(bad)).rejects.toBeInstanceOf(DigestMismatchError);
  });

  it("rejects a multi-file whose declared total exceeds the hard ceiling", async () => {
    const msg = await buildFilesMessage([A, B]);
    const [manifest, entries] = cborDecode(msg) as [CborMap, unknown[]];
    ((entries[0] as unknown[])[0] as CborMap).set(3, 9_000_000); // HeaderKey.origSize lie -> total > 8 MiB
    const bad = cborEncode([manifest, entries] as never);
    await expect(openFilesMessage(bad)).rejects.toBeInstanceOf(MalformedMessageError);
  });

  it("openMessage (single) refuses a multi-file message", async () => {
    await expect(openMessage(await buildFilesMessage([A, B]))).rejects.toBeInstanceOf(MalformedMessageError);
  });

  it("caps the file count", async () => {
    const many = Array.from({ length: MAX_FILE_COUNT + 1 }, (_, i) => textInput(`f${i}.txt`, "x"));
    await expect(buildFilesMessage(many)).rejects.toBeTruthy();
  });
});
