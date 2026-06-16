/**
 * Deterministic test environment.
 *
 * Many full-game / AI-simulation tests create games via initGameFromDecks /
 * initRoomGame WITHOUT an explicit seed. The engine then draws ONE fresh
 * `Math.random()` seed at game creation (see rng.ts resolveSeed), so those tests
 * play a different random shuffle on every run and a shuffle-dependent assertion
 * occasionally flakes (~1 in 9 full-suite runs).
 *
 * Seeding `Math.random` once per test file makes every such game reproducible:
 * the same shuffles every run, so the suite is deterministic. Games still vary
 * within a file (the seeded sequence advances per game), so this doesn't force
 * every test onto one identical shuffle.
 *
 * The chaos suite saves and restores `Math.random` around its own seeded games
 * (withSeededRandom), so it is unaffected by this global seeding.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

Math.random = mulberry32(0x5eed1234);
