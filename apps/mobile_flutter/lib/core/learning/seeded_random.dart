/// Deterministic hashing and PRNG, bit-for-bit identical to `packages/curriculum/src/planner/random.ts`
/// (`fnv1a32`, mulberry32 `Seeded`), so shuffles and interval fuzz match the API on every platform.
///
/// All arithmetic stays within 32 bits per step: Flutter web compiles `int` to JavaScript numbers, where a
/// plain 32×32-bit product loses its low bits above 2^53.
library;

const _mask32 = 0xFFFFFFFF;

/// `Math.imul` (low 32 bits of the product), returned as an unsigned 32-bit value.
int imul32(int a, int b) {
  final aHi = (a >>> 16) & 0xFFFF;
  final aLo = a & 0xFFFF;
  final bHi = (b >>> 16) & 0xFFFF;
  final bLo = b & 0xFFFF;
  return (aLo * bLo + ((((aHi * bLo) + (aLo * bHi)) & 0xFFFF) << 16)) & _mask32;
}

/// 32-bit FNV-1a over UTF-16 code units (JavaScript `charCodeAt`).
int fnv1a32(String input) {
  var hash = 0x811c9dc5;
  for (final unit in input.codeUnits) {
    hash = (hash ^ unit) & _mask32;
    hash = imul32(hash, 0x01000193);
  }
  return hash;
}

/// mulberry32, seeded from a string (FNV-1a) or an integer.
class Seeded {
  int _state;

  Seeded(Object seed) : _state = _initialState(seed);

  static int _initialState(Object seed) {
    final s = seed is String ? fnv1a32(seed) : (seed as int) & _mask32;
    return s == 0 ? 0x9e3779b9 : s;
  }

  /// Uniform double in [0, 1).
  double next() {
    _state = (_state + 0x6d2b79f5) & _mask32;
    var t = _state;
    t = imul32(t ^ (t >>> 15), t | 1);
    t = (t ^ ((t + imul32(t ^ (t >>> 7), t | 61)) & _mask32)) & _mask32;
    return ((t ^ (t >>> 14)) & _mask32) / 4294967296;
  }

  /// Uniform double in [min, max).
  double range(double min, double max) => min + (max - min) * next();
}
