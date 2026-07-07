// Human-facing file-size thresholds for the sender (blueprint §9 soft warning,
// §11 S6). Pure and DOM-free so it is unit-testable.
import { HARD_MAX_DECOMPRESSED_BYTES } from "../core/index.js";

export const SOFT_CEILING_BYTES = 2 * 1024 * 1024; // 2 MB — the blueprint's soft warning point
export const HARD_CEILING_BYTES = HARD_MAX_DECOMPRESSED_BYTES; // the receiver refuses to inflate past this

export type SizeLevel = "ok" | "soft" | "hard";

// Never blocks — this only produces advisory copy. `hard` warns that the receiver
// will refuse the file (its decompression cap); `soft` warns it will be slow.
export function describeSize(bytes: number): { level: SizeLevel; warn: string } {
  if (bytes > HARD_CEILING_BYTES) {
    return {
      level: "hard",
      warn: "Over the receiver's ~8 MB limit — it will refuse this file. Send something smaller, or split it.",
    };
  }
  if (bytes > SOFT_CEILING_BYTES) {
    return {
      level: "soft",
      warn: "Large file — this will be slow over QR. Keep both screens steady and give it time.",
    };
  }
  return { level: "ok", warn: "" };
}
