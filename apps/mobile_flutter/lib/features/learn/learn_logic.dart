/// Pure logic for the learn path (N2) and the L3 mini-games. No Flutter imports: unit-tested in
/// `test/learn_logic_test.dart`.
library;

import '../../core/learning/seeded_random.dart';

/// The four stops of a mission node, in teaching order: learn it, practise it, use it, talk freely.
enum PathStop { learn, practise, mission, talk }

/// Which stops a mission node offers. Learn and Practise exist only when the mission has a teaching block;
/// Talk only when a live conversation partner backs it (the offline app has none, so the stop is hidden rather
/// than faked — CONVENTIONS §8: visible means usable).
List<PathStop> stopsFor({required bool hasLearnPlan, bool canTalk = false}) => [
  if (hasLearnPlan) ...[PathStop.learn, PathStop.practise],
  PathStop.mission,
  if (canTalk) PathStop.talk,
];

/// The stop to suggest next: the first one not done yet, or null when the node is finished.
PathStop? nextStop(List<PathStop> stops, Set<PathStop> done) {
  for (final stop in stops) {
    if (!done.contains(stop)) return stop;
  }
  return null;
}

/// Share of the node's stops that are done (0..1), for the small progress ring on the pathway.
double nodeProgress(List<PathStop> stops, Set<PathStop> done) {
  if (stops.isEmpty) return 0;
  return stops.where(done.contains).length / stops.length;
}

/// Deterministic 32-bit FNV-1a so an order is stable across rebuilds and devices (web included: `fnv1a32`
/// keeps every product within 32 bits, which a plain `h * prime` does not on JavaScript numbers).
int stableHash(String text) => fnv1a32(text);

/// A stable, seed-dependent shuffle (never "answer always first").
List<T> stableShuffle<T>(List<T> items, String seed, String Function(T) keyOf) {
  final copy = [...items];
  copy.sort((a, b) => stableHash('$seed:${keyOf(a)}').compareTo(stableHash('$seed:${keyOf(b)}')));
  return copy;
}

// --- Pairs game: match each phrase with its meaning ------------------------------------------------

enum PairSide { phrase, meaning }

class PairsCard {
  final String pairId;
  final PairSide side;
  final String label;
  const PairsCard({required this.pairId, required this.side, required this.label});
  String get key => '${side.name}:$pairId';
}

class PairsState {
  final List<PairsCard> phrases;
  final List<PairsCard> meanings;
  final Set<String> matched;

  /// The card picked first in the current attempt (either column), or null.
  final PairsCard? selected;

  /// The two cards of the last wrong attempt (shown briefly), or empty.
  final Set<String> wrongKeys;
  final int mistakes;

  const PairsState({required this.phrases, required this.meanings, this.matched = const {}, this.selected, this.wrongKeys = const {}, this.mistakes = 0});

  bool get finished => matched.length == phrases.length;

  factory PairsState.start(List<({String id, String phrase, String meaning})> pairs, String seed) {
    final phrases = stableShuffle([for (final p in pairs) PairsCard(pairId: p.id, side: PairSide.phrase, label: p.phrase)], '$seed/phrase', (c) => c.pairId);
    final meanings = stableShuffle(
      [for (final p in pairs) PairsCard(pairId: p.id, side: PairSide.meaning, label: p.meaning)],
      '$seed/meaning',
      (c) => c.pairId,
    );
    return PairsState(phrases: phrases, meanings: meanings);
  }

  /// Tap a card: first pick selects it; a pick in the other column checks the pair.
  PairsState tap(PairsCard card) {
    if (matched.contains(card.pairId)) return this;
    final first = selected;
    if (first == null || first.side == card.side) {
      return PairsState(phrases: phrases, meanings: meanings, matched: matched, selected: card, mistakes: mistakes);
    }
    if (first.pairId == card.pairId) {
      return PairsState(phrases: phrases, meanings: meanings, matched: {...matched, card.pairId}, mistakes: mistakes);
    }
    return PairsState(phrases: phrases, meanings: meanings, matched: matched, wrongKeys: {first.key, card.key}, mistakes: mistakes + 1);
  }

  /// Clear the wrong-attempt highlight (after a short delay in the UI).
  PairsState clearWrong() => PairsState(phrases: phrases, meanings: meanings, matched: matched, selected: selected, mistakes: mistakes);
}

// --- Tiles game: rebuild a sentence ------------------------------------------------------------------

class TileItem {
  final int index;
  final String text;
  const TileItem(this.index, this.text);
}

enum TilesVerdict { building, correct, wrong }

class TilesState {
  /// Every tile (answer + distractors) in a stable shuffled order; `index` identifies a tile.
  final List<TileItem> bank;

  /// Indices of the tiles placed so far, in order.
  final List<int> placed;
  final List<String> answer;
  final TilesVerdict verdict;

  const TilesState({required this.bank, required this.answer, this.placed = const [], this.verdict = TilesVerdict.building});

  factory TilesState.start(List<String> answer, List<String> distractors, String seed) {
    final tiles = [for (var i = 0; i < answer.length + distractors.length; i++) TileItem(i, i < answer.length ? answer[i] : distractors[i - answer.length])];
    return TilesState(bank: stableShuffle(tiles, seed, (t) => '${t.index}:${t.text}'), answer: answer);
  }

  List<String> get sentence => [for (final i in placed) bank.firstWhere((t) => t.index == i).text];
  bool isPlaced(TileItem tile) => placed.contains(tile.index);

  TilesState place(TileItem tile) {
    if (isPlaced(tile) || verdict == TilesVerdict.correct) return this;
    return TilesState(bank: bank, answer: answer, placed: [...placed, tile.index]);
  }

  TilesState remove(TileItem tile) {
    if (verdict == TilesVerdict.correct) return this;
    return TilesState(bank: bank, answer: answer, placed: placed.where((i) => i != tile.index).toList());
  }

  /// Compare the built sentence with the answer, ignoring case and spacing around punctuation.
  TilesState check() {
    String norm(List<String> words) =>
        words.join(' ').toLowerCase().replaceAllMapped(RegExp(r'\s+([?!.,])'), (m) => m.group(1)!).replaceAll(RegExp(r'\s+'), ' ').trim();
    final ok = norm(sentence) == norm(answer);
    return TilesState(bank: bank, answer: answer, placed: placed, verdict: ok ? TilesVerdict.correct : TilesVerdict.wrong);
  }
}

/// A practice choice (three options, one right): a wrong pick is marked and can be followed by another; the right
/// pick solves it. No score. Immutable.
class ChoiceState {
  final int answer;
  final Set<int> wrong;
  final bool solved;

  const ChoiceState._(this.answer, this.wrong, this.solved);
  ChoiceState.start(int answer) : this._(answer, const {}, false);

  ChoiceState pick(int index) {
    if (solved) return this;
    if (index == answer) return ChoiceState._(answer, wrong, true);
    return ChoiceState._(answer, {...wrong, index}, false);
  }

  bool isWrong(int index) => wrong.contains(index);
}
