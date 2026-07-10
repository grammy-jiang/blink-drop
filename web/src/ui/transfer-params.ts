// Per-transfer transport knobs, overridable via sender URL params so the real
// optical ceiling can be found on the actual device (docs/23). Pure + DOM-free so
// it is unit-testable in isolation. A missing / malformed / out-of-range param
// falls back to the default and is clamped — a typo must never brick a transfer.
import {
  DEFAULT_MAX_FRAGMENT_LENGTH,
  DEFAULT_REDUNDANCY,
  MAX_FRAGMENT_LENGTH,
  MAX_REDUNDANCY,
  MIN_FRAGMENT_LENGTH,
  MIN_REDUNDANCY,
} from "../core/index.js";

export interface TransferParams {
  frag: number; // UR fragment length in bytes
  redundancy: number; // fountain parts per systematic part, per loop
}

function clampNum(raw: string | null, def: number, lo: number, hi: number): number {
  if (raw === null) return def;
  const v = Number(raw);
  if (!Number.isFinite(v)) return def;
  return Math.min(hi, Math.max(lo, v));
}

// Reads `?frag=<300..1200>` and `?redundancy=<1..5>` from a location-search string
// (e.g. `location.search`, "?frag=900&redundancy=3").
export function parseTransferParams(search: string): TransferParams {
  const p = new URLSearchParams(search);
  return {
    frag: Math.round(clampNum(p.get("frag"), DEFAULT_MAX_FRAGMENT_LENGTH, MIN_FRAGMENT_LENGTH, MAX_FRAGMENT_LENGTH)),
    redundancy: clampNum(p.get("redundancy"), DEFAULT_REDUNDANCY, MIN_REDUNDANCY, MAX_REDUNDANCY),
  };
}
