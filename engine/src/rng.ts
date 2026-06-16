/**
 * Deterministic, seedable PRNG threaded through the game state.
 *
 * The engine historically used unseeded `Math.random()` for shuffles, dice,
 * coin flips, the starting-player roll and AI jitter. That made games
 * impossible to replay: applying the same sequence of actions twice produced
 * different libraries/draws, so an independent observer (e.g. a server
 * verifying a multiplayer authority) could never reproduce the same result.
 *
 * Every source of game-affecting randomness now draws from a single PRNG whose
 * state lives on the `GameState` (`rngState`) and is serialized with it. Given
 * the same seed and the same actions, the engine is now fully reproducible.
 *
 * Algorithm: mulberry32 — a tiny, fast, well-distributed 32-bit generator.
 * 32 bits of state is plenty for game randomness and serializes as one number.
 */

/** Anything carrying a mutable PRNG cursor. In practice this is `GameState`. */
export interface RngHost {
  rngState?: number;
  /** Monotonic counter for deterministic id generation (triggers, tokens, …). */
  idCounter?: number;
}

/** Default seed used when a state has no seed yet (keeps old call paths working). */
export const DEFAULT_RNG_SEED = 0x9e3779b9;

/**
 * Hash an arbitrary string/number into a uint32 seed (xmur3). Use this to derive
 * a stable seed from something human-meaningful like a room id or game id.
 */
export function hashSeed(input: string | number): number {
  const text = String(input);
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Advance the host's PRNG and return a float in [0, 1). Mutates `host.rngState`
 * in place, so callers must operate on the same state object they intend to keep.
 */
export function nextRandom(host: RngHost): number {
  let a = (host.rngState ?? DEFAULT_RNG_SEED) | 0;
  a = (a + 0x6d2b79f5) | 0;
  host.rngState = a;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Deterministic integer in [0, maxExclusive). Returns 0 for non-positive bounds. */
export function randomInt(host: RngHost, maxExclusive: number): number {
  if (maxExclusive <= 0) return 0;
  return Math.floor(nextRandom(host) * maxExclusive);
}

/** Deterministic integer in [min, max] inclusive (e.g. a die roll). */
export function randomIntInclusive(host: RngHost, min: number, max: number): number {
  if (max <= min) return min;
  return min + randomInt(host, max - min + 1);
}

/** In-place Fisher-Yates shuffle using the host PRNG. Returns the same array. */
export function shuffleInPlace<T>(host: RngHost, array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = randomInt(host, i + 1);
    const tmp = array[i];
    array[i] = array[j];
    array[j] = tmp;
  }
  return array;
}

/** Shuffle a copy of `array` using the host PRNG, leaving the original untouched. */
export function shuffled<T>(host: RngHost, array: readonly T[]): T[] {
  return shuffleInPlace(host, [...array]);
}

/** Pick a deterministic element from a non-empty array (undefined if empty). */
export function randomPick<T>(host: RngHost, array: readonly T[]): T | undefined {
  if (array.length === 0) return undefined;
  return array[randomInt(host, array.length)];
}

/**
 * Generate a deterministic, collision-free id from the host's id counter.
 * Replaces the old `${Date.now()}_${Math.random()}` ids so two runs of the same
 * game produce identical object ids.
 */
export function nextId(host: RngHost, prefix: string): string {
  const next = (host.idCounter ?? 0) + 1;
  host.idCounter = next;
  return `${prefix}_${next}`;
}
