import { describe, expect, it } from "vitest";
import { describeSize, HARD_CEILING_BYTES, SOFT_CEILING_BYTES } from "../src/ui/size.js";

describe("describeSize (sender soft ceiling)", () => {
  it("no warning at or below the soft ceiling", () => {
    expect(describeSize(0).level).toBe("ok");
    expect(describeSize(1024).level).toBe("ok");
    expect(describeSize(SOFT_CEILING_BYTES).level).toBe("ok");
    expect(describeSize(SOFT_CEILING_BYTES).warn).toBe("");
  });

  it("soft warning between the soft and hard ceilings", () => {
    const r = describeSize(SOFT_CEILING_BYTES + 1);
    expect(r.level).toBe("soft");
    expect(r.warn).not.toBe("");
    expect(describeSize(HARD_CEILING_BYTES).level).toBe("soft");
  });

  it("hard warning above the receiver's cap (names the refusal)", () => {
    const r = describeSize(HARD_CEILING_BYTES + 1);
    expect(r.level).toBe("hard");
    expect(r.warn).toMatch(/refuse|limit/i);
  });
});
