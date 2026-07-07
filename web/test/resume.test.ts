import { describe, expect, it } from "vitest";
import { decryptPartial, encryptPartial, isExpired, type ResumePartial } from "../src/receiver/resume.js";

// The IndexedDB + non-extractable-key path is browser-verified (a CryptoKey is
// structured-cloned into IDB, which node's fake IDB can't reproduce). Here we test
// the pure at-rest crypto + expiry with an injected key.
async function makeKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

describe("resume storage — at-rest crypto + expiry (docs/11)", () => {
  const partial: ResumePartial = {
    parts: ["UR:BLINK-DROP/1-3/AAA", "UR:BLINK-DROP/2-3/BBB"],
    percent: 66,
    frames: 3,
    savedAt: 1000,
  };

  it("round-trips a partial through AES-GCM, and the blob has no readable parts", async () => {
    const key = await makeKey();
    const blob = await encryptPartial(key, partial);
    expect(new TextDecoder().decode(blob.ct)).not.toContain("BLINK-DROP");
    expect(await decryptPartial(key, blob)).toEqual(partial);
  });

  it("a different key cannot decrypt (fails closed)", async () => {
    const blob = await encryptPartial(await makeKey(), partial);
    await expect(decryptPartial(await makeKey(), blob)).rejects.toBeTruthy();
  });

  it("isExpired honors the TTL", () => {
    expect(isExpired(1000, 1005, 10)).toBe(false);
    expect(isExpired(1000, 1020, 10)).toBe(true);
  });
});
