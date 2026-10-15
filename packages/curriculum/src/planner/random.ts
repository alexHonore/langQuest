/**
 * Seeded determinism helpers. The curriculum package never calls `Math.random`:
 * every choice that should vary (scene variants, distractors, exercise order) is
 * derived from an explicit seed so offline packs and retries are reproducible.
 */

/** 32-bit FNV-1a hash of a string (stable across platforms). */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Small, fast, deterministic PRNG (mulberry32). */
export class Seeded {
  private state: number;

  constructor(seed: number | string) {
    this.state = (typeof seed === 'string' ? fnv1a32(seed) : seed >>> 0) || 0x9e3779b9;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [0, maxExclusive). Returns 0 when maxExclusive <= 0. */
  int(maxExclusive: number): number {
    if (maxExclusive <= 0) return 0;
    return Math.floor(this.next() * maxExclusive);
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Pick one element (undefined for empty arrays). */
  pick<T>(items: readonly T[]): T | undefined {
    return items.length ? items[this.int(items.length)] : undefined;
  }

  /** Fisher–Yates shuffle into a new array. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = out[i]!;
      out[i] = out[j]!;
      out[j] = tmp;
    }
    return out;
  }

  /** Up to `n` distinct elements, in seeded order. */
  sample<T>(items: readonly T[], n: number): T[] {
    return this.shuffle(items).slice(0, Math.max(0, n));
  }
}
