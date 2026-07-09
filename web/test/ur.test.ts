import { describe, expect, test } from "vitest";
import {
  Assembler,
  buildMessage,
  type FileInput,
  MAX_SEQ_LEN,
  qrPartStream,
  systematicQrParts,
} from "../src/core/index.js";

// Direct tests for the UR transport wrapper (src/core/ur.ts). The reconstruction
// itself is exercised broadly elsewhere; these pin the contracts a bc-ur wrapper
// can silently break — part count, the QR uppercasing, the DoS seq-count guard,
// garbled-frame handling, and the message() precondition. (Added to kill the
// Stryker survivors in ur.ts.)

async function msgOf(text: string): Promise<Uint8Array> {
  const input: FileInput = { bytes: new TextEncoder().encode(text), name: "a.txt", mediaType: "text/plain" };
  return buildMessage(input);
}

describe("ur transport wrapper", () => {
  test("qrPartStream returns exactly `count` parts, all uppercased", async () => {
    const msg = await msgOf("blink-drop qr part stream");
    const parts = qrPartStream(msg, 7, 40);
    expect(parts).toHaveLength(7); // kills the i<=count and array-init mutants
    for (const p of parts) {
      expect(p).toBe(p.toUpperCase()); // kills the .toLowerCase() mutant
      expect(p.startsWith("UR:BLINK-DROP/")).toBe(true);
    }
  });

  test("systematic parts are uppercased and reconstruct → message() returns bytes", async () => {
    const msg = await msgOf("systematic reconstruction path");
    const parts = systematicQrParts(msg, 40);
    for (const p of parts) expect(p).toBe(p.toUpperCase());
    const asm = new Assembler();
    for (const p of parts) asm.receiveQr(p);
    expect(asm.isSuccess).toBe(true);
    expect(asm.message().length).toBeGreaterThan(0); // exercises the success branch of message()
  });

  test("receiveQr drops garbled / corrupt frames (returns false, never throws)", async () => {
    const asm = new Assembler();
    expect(asm.receiveQr("this is not a ur at all")).toBe(false);
    expect(asm.receiveQr("ur:blink-drop/1-2/!!!not-bytewords!!!")).toBe(false);
    // A real multipart frame with its bytewords corrupted: bc-ur's decode throws
    // on the bad CRC; the catch must swallow it and return false, not crash the
    // scan loop and not report acceptance (kills the catch `return false → true`).
    const good = qrPartStream(await msgOf("corrupt this real frame please"), 3, 20)[0]!;
    const corrupt = good.slice(0, -4) + (good.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
    expect(() => asm.receiveQr(corrupt)).not.toThrow();
    expect(asm.receiveQr(corrupt)).toBe(false);
  });

  test("receiveQr rejects an over-cap declared part count before allocating (DoS guard)", async () => {
    // Take a real first part, then inflate only the declared seqLen in the URI.
    // Our guard reads the URI seq-count and must reject it > MAX_SEQ_LEN.
    const msg = await msgOf("multi part so there is a real sequence header here");
    const first = qrPartStream(msg, 3, 20)[0]!; // UR:BLINK-DROP/1-<seqLen>/...
    const evil = first.replace(/\/1-\d+\//, `/1-${MAX_SEQ_LEN + 1}/`);
    expect(new Assembler().receiveQr(evil)).toBe(false);
    // And a part at/under the cap is not rejected by the guard (a real transfer works).
    const asm = new Assembler();
    for (const p of systematicQrParts(msg, 20)) asm.receiveQr(p);
    expect(asm.isSuccess).toBe(true);
  });

  test("message() throws before the transfer is complete", () => {
    expect(() => new Assembler().message()).toThrow(); // kills the @96 conditional + NoCoverage
  });

  test("progress getters return numbers before completion", () => {
    const asm = new Assembler();
    // Fresh decoder reports 0 of an unknown total (isComplete/isSuccess are
    // undefined here, so aren't asserted). Concrete values kill the empty-block
    // mutants on these two getters.
    expect(asm.expectedPartCount).toBe(0);
    expect(asm.percentComplete).toBe(0);
  });
});
