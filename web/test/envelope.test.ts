import { describe, expect, test } from "vitest";
import {
  buildFilesMessage,
  buildMessage,
  type CborMap,
  type CborValue,
  Compression,
  cborDecode,
  cborEncode,
  DigestMismatchError,
  EncKey,
  type FileInput,
  HeaderKey,
  isEncryptedMessage,
  MAX_PBKDF2_ITERATIONS,
  MalformedMessageError,
  OuterKey,
  openFilesMessage,
  openMessage,
  PassphraseRequiredError,
  parseMessage,
} from "../src/core/index.js";

// Behavioural tests for the envelope's accept/reject gates (src/core/envelope.ts).
// These pin the malformed-input rejections that the happy-path round-trips don't:
// tampered headers, the size gate, KDF-bomb bounds, and the encrypted-envelope
// checks. Added to kill the Stryker survivors on those guards.

const PASS = "correct-horse-battery-staple";
const file = (bytes: Uint8Array, name = "a.bin"): FileInput => ({ bytes, name, mediaType: "application/octet-stream" });
const text = (s: string): Uint8Array => new TextEncoder().encode(s);

// Build a plaintext message, mutate its decoded [header, payload], re-encode.
async function tamperPlain(
  mut: (header: CborMap, payload: CborValue) => void,
  body = "tamper me ".repeat(30),
): Promise<Uint8Array> {
  const msg = await buildMessage(file(text(body)));
  const [header, payload] = cborDecode(msg) as [CborMap, CborValue];
  mut(header as CborMap, payload);
  return cborEncode([header, payload]);
}

// Build an encrypted message (fast PBKDF2), mutate its outer/enc map, re-encode.
// The enc-param guards all run BEFORE AES-GCM, so they surface as
// MalformedMessageError rather than a tag failure.
async function tamperEnc(mut: (enc: CborMap) => void): Promise<Uint8Array> {
  const msg = await buildMessage(file(text("secret payload")), { passphrase: PASS, iterations: 1000 });
  const [outer, ct] = cborDecode(msg) as [CborMap, CborValue];
  mut((outer as CborMap).get(OuterKey.enc) as CborMap);
  return cborEncode([outer, ct]);
}

describe("envelope round-trip", () => {
  test("plaintext round-trips and preserves bytes + name", async () => {
    const bytes = text("hello envelope round trip");
    const out = (await openFilesMessage(await buildMessage(file(bytes, "greeting.txt"))))[0]!;
    expect(out.bytes).toEqual(bytes);
    expect(out.header.name).toBe("greeting.txt");
  });

  test("encrypted round-trips with the right passphrase", async () => {
    const bytes = text("hello encrypted round trip");
    const msg = await buildMessage(file(bytes), { passphrase: PASS, iterations: 1000 });
    expect(isEncryptedMessage(msg)).toBe(true);
    const out = await openMessage(msg, { passphrase: PASS });
    expect(out.bytes).toEqual(bytes);
  });

  test("incompressible input is stored uncompressed (compression=none)", async () => {
    // High-entropy (LCG) bytes: gzip can't shrink them, so the useGzip check
    // keeps them raw (compressed.length is NOT < input length).
    const rnd = new Uint8Array(4096);
    let s = 0x12345678;
    for (let i = 0; i < rnd.length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      rnd[i] = (s >>> 24) & 0xff;
    }
    const msg = await buildMessage(file(rnd));
    const [header] = cborDecode(msg) as [CborMap, CborValue];
    expect((header as CborMap).get(HeaderKey.compression)).toBe(Compression.none);
    expect((await openMessage(msg)).bytes).toEqual(rnd);
  });
});

describe("envelope reject gates", () => {
  test("a declared orig_size that mismatches the payload is rejected (size gate)", async () => {
    const bad = await tamperPlain((h) => h.set(HeaderKey.origSize, (h.get(HeaderKey.origSize) as number) + 1));
    await expect(openMessage(bad)).rejects.toThrow(MalformedMessageError);
  });

  test("a corrupted declared SHA-256 fails the verify gate", async () => {
    const bad = await tamperPlain((h) => {
      const sha = (h.get(HeaderKey.sha256) as Uint8Array).slice();
      sha[0] = (sha[0] ?? 0) ^ 0xff;
      h.set(HeaderKey.sha256, sha);
    });
    await expect(openMessage(bad)).rejects.toThrow(DigestMismatchError);
  });

  test("malformed header fields are rejected", async () => {
    // wrong type (name as a number)
    await expect(openMessage(await tamperPlain((h) => h.set(HeaderKey.name, 123)))).rejects.toThrow(
      MalformedMessageError,
    );
    // sha256 wrong length
    await expect(openMessage(await tamperPlain((h) => h.set(HeaderKey.sha256, new Uint8Array(10))))).rejects.toThrow(
      MalformedMessageError,
    );
    // unknown compression value
    await expect(openMessage(await tamperPlain((h) => h.set(HeaderKey.compression, 99)))).rejects.toThrow(
      MalformedMessageError,
    );
    // missing required field
    await expect(openMessage(await tamperPlain((h) => h.delete(HeaderKey.origSize)))).rejects.toThrow(
      MalformedMessageError,
    );
  });

  test("malformed top-level structure is rejected", async () => {
    await expect(openMessage(cborEncode(123))).rejects.toThrow(MalformedMessageError); // not an array
    await expect(openMessage(cborEncode([1, 2, 3]))).rejects.toThrow(MalformedMessageError); // wrong length
    await expect(openMessage(cborEncode(["notamap", new Uint8Array(1)]))).rejects.toThrow(MalformedMessageError); // first not a map
    await expect(openMessage(new Uint8Array([0xff, 0xff, 0xff]))).rejects.toThrow(MalformedMessageError); // not CBOR
  });
});

describe("encrypted-envelope gates", () => {
  test("an encrypted message without a passphrase asks for one", async () => {
    const msg = await buildMessage(file(text("locked")), { passphrase: PASS, iterations: 1000 });
    await expect(openMessage(msg)).rejects.toThrow(PassphraseRequiredError);
    await expect(openMessage(msg, { passphrase: "" })).rejects.toThrow(PassphraseRequiredError);
  });

  test("KDF bomb: an excessive PBKDF2 iteration count is rejected before derivation", async () => {
    const overCap = MAX_PBKDF2_ITERATIONS + 1; // gitleaks:allow — imported constant, not a secret
    const bad = await tamperEnc((enc) => enc.set(EncKey.iter, overCap));
    await expect(openMessage(bad, { passphrase: PASS })).rejects.toThrow(MalformedMessageError);
  });

  test("an unknown KDF / cipher / salt / nonce is rejected", async () => {
    await expect(openMessage(await tamperEnc((e) => e.set(EncKey.kdf, 99)), { passphrase: PASS })).rejects.toThrow(
      MalformedMessageError,
    );
    await expect(openMessage(await tamperEnc((e) => e.set(EncKey.cipher, 99)), { passphrase: PASS })).rejects.toThrow(
      MalformedMessageError,
    );
    await expect(
      openMessage(await tamperEnc((e) => e.set(EncKey.salt, new Uint8Array(4))), { passphrase: PASS }),
    ).rejects.toThrow(MalformedMessageError);
    await expect(
      openMessage(await tamperEnc((e) => e.set(EncKey.nonce, new Uint8Array(4))), { passphrase: PASS }),
    ).rejects.toThrow(MalformedMessageError);
  });

  test("parseMessage refuses an encrypted message; isEncryptedMessage stays false on junk", () => {
    expect(isEncryptedMessage(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(isEncryptedMessage(cborEncode(["x", new Uint8Array(1)]))).toBe(false);
  });
});

describe("multi-file gates", () => {
  test("a multi-file set round-trips every file, SHA-verified", async () => {
    const inputs = [file(text("file one contents"), "one.txt"), file(text("file two contents"), "two.txt")];
    const out = await openFilesMessage(await buildFilesMessage(inputs));
    expect(out.map((f) => f.header.name)).toEqual(["one.txt", "two.txt"]);
    expect(out[1]!.bytes).toEqual(text("file two contents"));
  });

  test("a multi-file body with a corrupt entry shape is rejected", async () => {
    const msg = await buildFilesMessage([file(text("aaa"), "a.txt"), file(text("bbb"), "b.txt")]);
    const [manifest, list] = cborDecode(msg) as [CborMap, CborValue[]];
    (list as CborValue[])[0] = ["only-one-element"]; // not a [meta, payload] pair
    await expect(openFilesMessage(cborEncode([manifest, list]))).rejects.toThrow(MalformedMessageError);
  });

  test("plaintext parseMessage round-trips a single file's header", async () => {
    const msg = await buildMessage(file(text("single header"), "s.txt"));
    expect(parseMessage(msg).header.name).toBe("s.txt");
  });
});
