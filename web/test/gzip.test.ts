import { describe, expect, test } from "vitest";
import { DecompressionOverflowError, gunzip, gzip } from "../src/core/index.js";

describe("gzip", () => {
  test("gzip → gunzip round-trips", async () => {
    const data = new TextEncoder().encode("blink-drop compresses well ".repeat(500));
    expect(await gunzip(await gzip(data), data.length)).toEqual(data);
  });

  test("gunzip refuses to inflate past the cap (SG-2 decompression bomb)", async () => {
    const data = new Uint8Array(20_000); // all-zeros → compresses to a few bytes
    const z = await gzip(data);
    // A cap below the true decompressed size must be rejected before buffering it all.
    await expect(gunzip(z, 10_000)).rejects.toThrow(DecompressionOverflowError);
    // Exactly at the cap is allowed (the guard is `> max`, not `>= max`).
    expect((await gunzip(z, 20_000)).length).toBe(20_000);
  });
});
