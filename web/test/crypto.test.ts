import { describe, expect, it } from "vitest";
import {
  buildMessage,
  bytesEqual,
  type CborMap,
  cborDecode,
  decodeQrPartsToFile,
  encodeFileToQrParts,
  type FileInput,
  isEncryptedMessage,
  MalformedMessageError,
  openMessage,
  PassphraseRequiredError,
  parseMessage,
  WrongPassphraseError,
} from "../src/core/index.js";

// Small work factor so the suite stays fast; production uses PBKDF2_ITERATIONS (600k).
const ITER = 2048;
const PASS = "correct horse battery staple";

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

// Does the raw message byte stream contain this ASCII substring?
function containsAscii(haystack: Uint8Array, needle: string): boolean {
  const n = new TextEncoder().encode(needle);
  outer: for (let i = 0; i + n.length <= haystack.length; i++) {
    for (let j = 0; j < n.length; j++) if (haystack[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
}

describe("envelope encryption (docs/07)", () => {
  it("encrypted build -> open round-trips and preserves the header", async () => {
    const input = textInput("secret.txt", "top secret payload ".repeat(20));
    const message = await buildMessage(input, { passphrase: PASS, iterations: ITER });
    expect(isEncryptedMessage(message)).toBe(true);

    const decoded = await openMessage(message, { passphrase: PASS });
    expect(bytesEqual(decoded.bytes, input.bytes)).toBe(true);
    expect(decoded.header.name).toBe("secret.txt");
    expect(decoded.header.mediaType).toBe("text/plain");
    expect(decoded.header.origSize).toBe(input.bytes.length);
  });

  it("round-trips an encrypted stream through QR parts", async () => {
    const input = textInput("note.txt", "the quick brown fox ".repeat(40));
    const parts = await encodeFileToQrParts(input, 200, { passphrase: PASS, iterations: ITER });
    const decoded = await decodeQrPartsToFile(parts, { passphrase: PASS });
    expect(bytesEqual(decoded.bytes, input.bytes)).toBe(true);
  });

  it("wrong passphrase fails closed with WrongPassphraseError (file withheld)", async () => {
    const message = await buildMessage(textInput("s.txt", "hello".repeat(30)), { passphrase: PASS, iterations: ITER });
    await expect(openMessage(message, { passphrase: "wrong passphrase" })).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it("missing passphrase on an encrypted message asks (PassphraseRequiredError), does not fail", async () => {
    const message = await buildMessage(textInput("s.txt", "data".repeat(30)), { passphrase: PASS, iterations: ITER });
    await expect(openMessage(message)).rejects.toBeInstanceOf(PassphraseRequiredError);
    await expect(openMessage(message, { passphrase: "" })).rejects.toBeInstanceOf(PassphraseRequiredError);
  });

  it("tampered ciphertext is rejected by the GCM tag", async () => {
    const message = await buildMessage(textInput("s.txt", "x".repeat(64)), { passphrase: PASS, iterations: ITER });
    const [outer, ciphertext] = cborDecode(message) as [CborMap, Uint8Array];
    const flipped = new Uint8Array(ciphertext);
    flipped[0] = flipped[0]! ^ 0xff;
    const { encode: cborEncode } = await import("../src/core/cbor.js");
    const bad = cborEncode([outer, flipped] as never);
    await expect(openMessage(bad, { passphrase: PASS })).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it("AAD binds the enc params: swapping the nonce breaks the tag", async () => {
    const message = await buildMessage(textInput("s.txt", "y".repeat(64)), { passphrase: PASS, iterations: ITER });
    const [outer, ciphertext] = cborDecode(message) as [CborMap, Uint8Array];
    const params = outer.get(6) as CborMap; // OuterKey.enc
    const nonce = params.get(5) as Uint8Array; // EncKey.nonce
    const twisted = new Uint8Array(nonce);
    twisted[0] = twisted[0]! ^ 0x01;
    params.set(5, twisted);
    const { encode: cborEncode } = await import("../src/core/cbor.js");
    const bad = cborEncode([outer, ciphertext] as never);
    await expect(openMessage(bad, { passphrase: PASS })).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it("does not leak the filename in the message bytes (metadata sealed)", async () => {
    const NAME = "SUPER-SECRET-FILENAME.txt";
    const input = textInput(NAME, "payload ".repeat(10));
    const encrypted = await buildMessage(input, { passphrase: PASS, iterations: ITER });
    const plaintext = await buildMessage(input);
    expect(containsAscii(plaintext, NAME)).toBe(true); // sanity: plaintext DOES carry it
    expect(containsAscii(encrypted, NAME)).toBe(false); // encrypted must NOT
  });

  it("is deterministic when salt+nonce+iterations are pinned (test-vector reproducibility)", async () => {
    const input = textInput("v.txt", "vector body ".repeat(8));
    const salt = new Uint8Array(16).fill(0xa1);
    const nonce = new Uint8Array(12).fill(0xb2);
    const a = await buildMessage(input, { passphrase: PASS, salt, nonce, iterations: ITER });
    const b = await buildMessage(input, { passphrase: PASS, salt, nonce, iterations: ITER });
    expect(bytesEqual(a, b)).toBe(true);
    // A different nonce yields different ciphertext.
    const c = await buildMessage(input, {
      passphrase: PASS,
      salt,
      nonce: new Uint8Array(12).fill(0xc3),
      iterations: ITER,
    });
    expect(bytesEqual(a, c)).toBe(false);
  });

  it("encrypts an incompressible payload (compression=0 path inside the envelope)", async () => {
    const input: FileInput = { bytes: pseudoBytes(64, 9), name: "r.bin", mediaType: "application/octet-stream" };
    const message = await buildMessage(input, { passphrase: PASS, iterations: ITER });
    const decoded = await openMessage(message, { passphrase: PASS });
    expect(bytesEqual(decoded.bytes, input.bytes)).toBe(true);
  });

  it("leaves the plaintext path untouched (no passphrase = today's wire format)", async () => {
    const input = textInput("plain.txt", "unencrypted ".repeat(10));
    const message = await buildMessage(input);
    expect(isEncryptedMessage(message)).toBe(false);
    // Still parseable by the plaintext-only parser.
    const { header } = parseMessage(message);
    expect(header.name).toBe("plain.txt");
    const decoded = await openMessage(message);
    expect(bytesEqual(decoded.bytes, input.bytes)).toBe(true);
  });
});

describe("envelope encryption — Argon2id KDF (docs/09, v0.4)", () => {
  const ARGON = { m: 512, t: 1, p: 1 }; // tiny cost for test speed; production m=19 MiB

  it("argon2id build -> open round-trips; the envelope names argon2id", async () => {
    const input = textInput("a.txt", "argon secret ".repeat(20));
    const msg = await buildMessage(input, { passphrase: PASS, kdf: "argon2id", argon: ARGON });
    expect(isEncryptedMessage(msg)).toBe(true);
    const [outer] = cborDecode(msg) as [CborMap, Uint8Array];
    expect((outer.get(6) as CborMap).get(1)).toBe("argon2id"); // EncKey.kdf
    const decoded = await openMessage(msg, { passphrase: PASS });
    expect(bytesEqual(decoded.bytes, input.bytes)).toBe(true);
    expect(decoded.header.name).toBe("a.txt");
  });

  it("wrong passphrase on argon2id fails closed", async () => {
    const msg = await buildMessage(textInput("s.txt", "x".repeat(40)), {
      passphrase: PASS,
      kdf: "argon2id",
      argon: ARGON,
    });
    await expect(openMessage(msg, { passphrase: "wrong" })).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it("pbkdf2 and argon2id messages both open — the kdf id drives derivation", async () => {
    const input = textInput("m.txt", "mixed kdfs");
    const a = await buildMessage(input, { passphrase: PASS, iterations: ITER }); // pbkdf2
    const b = await buildMessage(input, { passphrase: PASS, kdf: "argon2id", argon: ARGON }); // argon2id
    expect(bytesEqual((await openMessage(a, { passphrase: PASS })).bytes, input.bytes)).toBe(true);
    expect(bytesEqual((await openMessage(b, { passphrase: PASS })).bytes, input.bytes)).toBe(true);
  });

  it("unknown kdf fails closed (MalformedMessageError), never mis-accepts", async () => {
    const msg = await buildMessage(textInput("s.txt", "y".repeat(40)), {
      passphrase: PASS,
      kdf: "argon2id",
      argon: ARGON,
    });
    const [outer, ct] = cborDecode(msg) as [CborMap, Uint8Array];
    (outer.get(6) as CborMap).set(1, "scrypt"); // unknown kdf
    const { encode: cborEncode } = await import("../src/core/cbor.js");
    const bad = cborEncode([outer, ct] as never);
    await expect(openMessage(bad, { passphrase: PASS })).rejects.toBeInstanceOf(MalformedMessageError);
  });

  it("AAD binds the argon2 cost params: tampering m breaks the tag", async () => {
    const msg = await buildMessage(textInput("s.txt", "z".repeat(40)), {
      passphrase: PASS,
      kdf: "argon2id",
      argon: ARGON,
    });
    const [outer, ct] = cborDecode(msg) as [CborMap, Uint8Array];
    const argonParams = (outer.get(6) as CborMap).get(2) as CborMap; // EncKey.iter → argon {m,t,p}
    argonParams.set(1, (argonParams.get(1) as number) + 256); // change m
    const { encode: cborEncode } = await import("../src/core/cbor.js");
    const bad = cborEncode([outer, ct] as never);
    await expect(openMessage(bad, { passphrase: PASS })).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it("is deterministic when salt+nonce+params are pinned (vector reproducibility)", async () => {
    const input = textInput("v.txt", "vector body");
    const salt = new Uint8Array(16).fill(0x11);
    const nonce = new Uint8Array(12).fill(0x22);
    const a = await buildMessage(input, { passphrase: PASS, kdf: "argon2id", argon: ARGON, salt, nonce });
    const b = await buildMessage(input, { passphrase: PASS, kdf: "argon2id", argon: ARGON, salt, nonce });
    expect(bytesEqual(a, b)).toBe(true);
  });
});
