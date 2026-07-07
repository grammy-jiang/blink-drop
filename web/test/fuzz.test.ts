import { describe, expect, it } from "vitest";
import { Assembler, isEncryptedMessage, openMessage, parseMessage } from "../src/core/index.js";

// Decoder fuzz (docs/16 Fix C, concern #12). Throw garbage bytes / malformed CBOR
// / malformed UR parts at the decode surface and assert it degrades cleanly:
// only the KNOWN typed errors are ever thrown, never an unexpected crash
// (TypeError / RangeError / undefined-deref), and the "never throws" helpers hold.

// Deterministic LCG so any failure reproduces (no Math.random / Date in tests).
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

// Errors the decoder is ALLOWED to throw on hostile input. Anything else is a bug.
const ALLOWED = new Set([
  "MalformedMessageError",
  "DigestMismatchError",
  "PassphraseRequiredError",
  "WrongPassphraseError",
  "CborError",
  "DecompressionOverflowError",
]);

function assertTypedError(e: unknown): void {
  expect(e).toBeInstanceOf(Error);
  const name = (e as Error).name;
  if (!ALLOWED.has(name)) {
    throw new Error(`unexpected error type from decoder: ${name}: ${(e as Error).message}`);
  }
}

describe("decoder fuzz — hostile input degrades to typed errors, never a crash", () => {
  it("openMessage/parseMessage on random bytes only throw allowlisted errors", async () => {
    const rng = makeRng(0x1234_5678);
    for (let iter = 0; iter < 300; iter++) {
      const len = rng() % 256;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = rng() & 0xff;

      // isEncryptedMessage is documented "never throws".
      expect(() => isEncryptedMessage(bytes)).not.toThrow();

      // parseMessage is sync; openMessage is async, with and without a passphrase.
      try {
        parseMessage(bytes);
      } catch (e) {
        assertTypedError(e);
      }
      try {
        await openMessage(bytes);
      } catch (e) {
        assertTypedError(e);
      }
      try {
        await openMessage(bytes, { passphrase: "fuzz-pass" });
      } catch (e) {
        assertTypedError(e);
      }
    }
  });

  it("Assembler.receiveQr on random strings returns a boolean and never throws", () => {
    const rng = makeRng(0x0bad_f00d);
    const alphabet = "ur:blinkdrop/0123456789abcdefghABCDEFGH-/:";
    for (let iter = 0; iter < 400; iter++) {
      const len = rng() % 120;
      let s = "";
      for (let i = 0; i < len; i++) s += alphabet[rng() % alphabet.length];
      const asm = new Assembler();
      let out: boolean | undefined;
      expect(() => {
        out = asm.receiveQr(s);
      }).not.toThrow();
      expect(typeof out).toBe("boolean");
    }
  });

  it("Assembler.receiveQr tolerates near-miss UR-looking parts", () => {
    const rng = makeRng(0xfeed_beef);
    for (let iter = 0; iter < 200; iter++) {
      const seq = rng() % 9999;
      const total = 1 + (rng() % 40);
      // Structurally UR-shaped but bogus bytewords body.
      const part = `ur:blink-drop/${seq}-${total}/${"lo".repeat(rng() % 30)}`;
      const asm = new Assembler();
      expect(() => asm.receiveQr(part)).not.toThrow();
    }
  });
});
