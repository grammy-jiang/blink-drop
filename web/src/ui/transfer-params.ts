// Per-transfer transport knob, overridable via a sender URL param so the real
// optical / CPU sweet spot can be found on the actual device (docs/23). Pure +
// DOM-free so it is unit-testable in isolation. A missing / malformed /
// out-of-range param falls back to the default and is clamped — a typo must never
// brick a transfer. (Fragment size is the only knob: the sender streams fountain
// parts continuously, so there is no redundancy multiple to tune.)
import { DEFAULT_MAX_FRAGMENT_LENGTH, MAX_FRAGMENT_LENGTH, MIN_FRAGMENT_LENGTH } from "../core/index.js";

export interface TransferParams {
  frag: number; // UR fragment length in bytes
}

function clampNum(raw: string | null, def: number, lo: number, hi: number): number {
  if (raw === null) return def;
  const v = Number(raw);
  if (!Number.isFinite(v)) return def;
  return Math.min(hi, Math.max(lo, v));
}

// Reads `?frag=<300..1500>` from a location-search string (e.g. `location.search`).
export function parseTransferParams(search: string): TransferParams {
  const p = new URLSearchParams(search);
  return {
    frag: Math.round(clampNum(p.get("frag"), DEFAULT_MAX_FRAGMENT_LENGTH, MIN_FRAGMENT_LENGTH, MAX_FRAGMENT_LENGTH)),
  };
}
