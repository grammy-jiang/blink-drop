import { describe, expect, it } from "vitest";
import {
  Assembler,
  buildMessage,
  type CborMap,
  cborDecode,
  cborEncode,
  encodeFileToQrParts,
  type FileInput,
  MAX_SEQ_LEN,
  MalformedMessageError,
  openMessage,
} from "../src/core/index.js";

// Regressions for the two confirmed audit findings (docs/12-security-audit-v0.6):
// both are hostile-input → resource-exhaustion DoS, now bounded at the boundary.
const PASS = "audit passphrase";
const ITER = 2048;

function textInput(name: string, text: string): FileInput {
  return { bytes: new TextEncoder().encode(text), name, mediaType: "text/plain" };
}

describe("security hardening — resource-exhaustion bounds (audit v0.6)", () => {
  it("M1 KDF bomb: a huge PBKDF2 iteration count is rejected before deriving", async () => {
    const msg = await buildMessage(textInput("s.txt", "x".repeat(40)), { passphrase: PASS, iterations: ITER });
    const [outer, ct] = cborDecode(msg) as [CborMap, Uint8Array];
    (outer.get(6) as CborMap).set(2, 1_000_000_000_000); // EncKey.iter -> 1e12
    const bad = cborEncode([outer, ct] as never);
    await expect(openMessage(bad, { passphrase: PASS })).rejects.toBeInstanceOf(MalformedMessageError);
  });

  it("M1 KDF bomb: excessive Argon2 memory is rejected before deriving", async () => {
    const msg = await buildMessage(textInput("s.txt", "y".repeat(40)), {
      passphrase: PASS,
      kdf: "argon2id",
      argon: { m: 512, t: 1, p: 1 },
    });
    const [outer, ct] = cborDecode(msg) as [CborMap, Uint8Array];
    const argon = (outer.get(6) as CborMap).get(2) as CborMap; // argon { m, t, p }
    argon.set(1, 1_000_000_000); // m far over MAX_ARGON2.m
    const bad = cborEncode([outer, ct] as never);
    await expect(openMessage(bad, { passphrase: PASS })).rejects.toBeInstanceOf(MalformedMessageError);
  });

  it("M2 seqLength bomb: an absurd UR part-count is dropped, never allocated", () => {
    const asm = new Assembler();
    expect(asm.receiveQr(`UR:BLINK-DROP/1-${MAX_SEQ_LEN + 1}/AXAXAXAX`)).toBe(false);
    expect(asm.receiveQr("UR:BLINK-DROP/1-999999999/AXAXAXAX")).toBe(false);
  });

  it("the guard does not block a real transfer's first part", async () => {
    const parts = await encodeFileToQrParts(textInput("ok.txt", "hello ".repeat(30)));
    const asm = new Assembler();
    expect(asm.receiveQr(parts[0]!)).toBe(true);
  });
});
