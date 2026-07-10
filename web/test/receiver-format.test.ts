import { describe, expect, it } from "vitest";
import { formatCaps, formatDuration } from "../src/ui/receiver-format.js";

describe("formatDuration", () => {
  it("shows whole seconds under a minute", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(7_400)).toBe("7s");
    expect(formatDuration(59_400)).toBe("59s");
  });
  it("shows m ss at or beyond a minute (zero-padded seconds)", () => {
    expect(formatDuration(60_000)).toBe("1m 00s");
    expect(formatDuration(65_000)).toBe("1m 05s");
    expect(formatDuration(83_000)).toBe("1m 23s");
    expect(formatDuration(600_000)).toBe("10m 00s");
  });
});

describe("formatCaps", () => {
  const caps = (width: number, height: number, scanFps: number) => formatCaps({ width, height, scanFps, decodeMs: 0 });

  it("labels 1080p and recommends sender ≤ half the scan rate", () => {
    expect(caps(1920, 1080, 19)).toBe("1080p · scan ~19 fps · keep sender ≤ 9");
  });
  it("labels 720p", () => {
    expect(caps(1280, 720, 20)).toContain("720p");
  });
  it("labels 480p", () => {
    expect(caps(640, 480, 16)).toContain("480p");
  });
  it("falls back to WxH below 480p", () => {
    expect(caps(320, 240, 10)).toContain("320×240");
  });
  it("never recommends a sender speed below 1", () => {
    expect(caps(640, 480, 1)).toContain("keep sender ≤ 1");
  });
});
