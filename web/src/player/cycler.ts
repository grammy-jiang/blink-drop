// Feeds the FramePlayer from a fixed pool of QR parts, RE-SHUFFLED each pass.
//
// Why not a continuous nextPart() stream: bc-ur shows each systematic (pure) part
// exactly once, then only fountain mixtures — so a fragment missed near the end
// can never be re-offered as a pure part and its recovery stalls (the last-1%
// tail; docs/23 test 3/4). Looping a pool re-offers every pure part each pass;
// reshuffling gives a chronically-missed fragment a different SCAN PHASE each pass,
// breaking the aliasing that otherwise misses the same frame every loop.
//
// Deterministic RNG (seeded, no Math.random) so playback is reproducible and the
// cycler is unit-testable.

export function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// Returns a producer for FramePlayer.load: yields every pool item once per pass in
// a fresh random order, then reshuffles and repeats. Endless.
export function shuffledCycler(pool: string[], rng: () => number): () => string {
  if (pool.length === 0) return () => "";
  let order: number[] = [];
  let i = pool.length; // force a shuffle on the first call
  const reshuffle = (): void => {
    order = pool.map((_, k) => k);
    for (let j = order.length - 1; j > 0; j--) {
      const r = Math.floor(rng() * (j + 1));
      const tmp = order[j]!;
      order[j] = order[r]!;
      order[r] = tmp;
    }
    i = 0;
  };
  return () => {
    if (i >= order.length) reshuffle();
    return pool[order[i++]!]!;
  };
}
