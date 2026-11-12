/// The mini-games' rules, without any Flutter: unit-tested in `test/games_test.dart`.
///
/// Every game plays with phrases the learner has already been taught (`game_pool.dart`), so a game never asks for
/// something new: it is another way to meet the same phrases — by memory, at speed, by ear, in the right order.
library;

import '../../core/learning/seeded_random.dart';
import '../learn/learn_content.dart';
import '../learn/learn_logic.dart';

/// A phrase a game can use: its id, how it is written, how tiles show it (its romanization for a non-Latin
/// script) and what it means, in short.
class GameItem {
  const GameItem({required this.id, required this.text, required this.meaning, this.tileSource = '', this.intent = ''});

  final String id;
  final String text;
  final String meaning;

  /// The words a sentence is rebuilt from; empty when the phrase cannot be rebuilt (too short, too long, a name to
  /// fill in).
  final String tileSource;

  /// Phrases with the same intent say the same thing in another way: never offered against each other.
  final String intent;
}

/// [items] in an order drawn from [seed] (the same seed gives the same game: tests, and a round that can be replayed).
List<T> seededShuffle<T>(List<T> items, Object seed) {
  final random = Seeded(seed);
  final copy = [...items];
  for (var i = copy.length - 1; i > 0; i--) {
    final j = (random.next() * (i + 1)).floor().clamp(0, i);
    final swap = copy[i];
    copy[i] = copy[j];
    copy[j] = swap;
  }
  return copy;
}

// --- Lantern pairs: find each phrase and its meaning, hidden under the lanterns --------------------------------

enum MemorySide { phrase, meaning }

class MemoryCard {
  const MemoryCard({required this.pairId, required this.side, required this.label});

  final String pairId;
  final MemorySide side;
  final String label;
}

/// The board: every card face down; two are turned at a time. A phrase and its meaning stay lit; two cards that do
/// not go together stay open until the next card is turned (or [closeOpen]). Immutable.
class MemoryState {
  const MemoryState._(this.cards, this.matched, this.open, this.moves);

  /// A board of [pairs] phrases (each gives two cards), laid out from [seed].
  factory MemoryState.start(List<GameItem> pairs, Object seed) => MemoryState._(
    List.unmodifiable(
      seededShuffle([
        for (final p in pairs) ...[
          MemoryCard(pairId: p.id, side: MemorySide.phrase, label: p.text),
          MemoryCard(pairId: p.id, side: MemorySide.meaning, label: p.meaning),
        ],
      ], seed),
    ),
    const {},
    const [],
    0,
  );

  final List<MemoryCard> cards;
  final Set<String> matched;

  /// The cards turned and not matched: none, one, or two that do not go together.
  final List<int> open;

  /// Pairs of cards turned so far.
  final int moves;

  bool get finished => matched.length * 2 == cards.length;
  bool isMatched(int index) => matched.contains(cards[index].pairId);
  bool isOpen(int index) => open.contains(index);

  /// Two cards are open and do not go together (the board turns them back).
  bool get mismatch => open.length == 2;

  MemoryState flip(int index) {
    if (index < 0 || index >= cards.length || isMatched(index) || isOpen(index)) return this;
    if (open.length != 1) return MemoryState._(cards, matched, [index], moves);
    final first = cards[open.first];
    final second = cards[index];
    if (first.pairId == second.pairId) return MemoryState._(cards, {...matched, first.pairId}, const [], moves + 1);
    return MemoryState._(cards, matched, [open.first, index], moves + 1);
  }

  /// Turns back two cards that do not go together.
  MemoryState closeOpen() => mismatch ? MemoryState._(cards, matched, const [], moves) : this;
}

// --- Quick fire: is it what it means? As many as possible before the time runs out ------------------------------

class QuickStatement {
  const QuickStatement({required this.item, required this.shown});

  final GameItem item;

  /// The phrase whose meaning is shown: [item] itself, or another one.
  final GameItem shown;

  bool get isTrue => item.id == shown.id;
}

/// A round of statements drawn from [pool] with [seed], true about half the time; the same phrase never comes twice
/// in a row. Endless: [statementAt] wraps around the pool, reshuffled.
class QuickRound {
  QuickRound(this.pool, this.seed) : assert(pool.length >= 2);

  final List<GameItem> pool;
  final Object seed;

  QuickStatement statementAt(int index) {
    final lap = index ~/ pool.length;
    final order = seededShuffle(pool, '$seed/lap/$lap');
    var item = order[index % pool.length];
    // The last phrase of a lap may open the next one: take its neighbour then.
    if (index > 0 && index % pool.length == 0) {
      final before = seededShuffle(pool, '$seed/lap/${lap - 1}').last;
      if (before.id == item.id) item = order[1 % order.length];
    }
    final random = Seeded('$seed/truth/$index');
    final others = [
      for (final o in seededShuffle(pool, '$seed/other/$index'))
        if (o.id != item.id && o.meaning != item.meaning && (o.intent.isEmpty || o.intent != item.intent)) o,
    ];
    final isTrue = others.isEmpty || random.next() < 0.5;
    return QuickStatement(item: item, shown: isTrue ? item : others.first);
  }
}

/// The score of a timed round. Immutable.
class QuickScore {
  const QuickScore({this.answered = 0, this.right = 0, this.streak = 0, this.bestStreak = 0});

  final int answered;
  final int right;
  final int streak;
  final int bestStreak;

  QuickScore answer(bool correct) => QuickScore(
    answered: answered + 1,
    right: right + (correct ? 1 : 0),
    streak: correct ? streak + 1 : 0,
    bestStreak: correct && streak + 1 > bestStreak ? streak + 1 : bestStreak,
  );
}

// --- By ear: hear a phrase, find it among the written ones ------------------------------------------------------

class EarQuestion {
  const EarQuestion({required this.item, required this.options});

  final GameItem item;
  final List<GameItem> options;

  int get answerIndex => options.indexWhere((o) => o.id == item.id);
}

/// [count] questions (fewer when [audible] is small) about phrases that can be said here, each with up to
/// [optionCount] written phrases to choose from, drawn from the whole [pool].
List<EarQuestion> earQuestions({required List<GameItem> pool, required List<GameItem> audible, required Object seed, int count = 8, int optionCount = 4}) {
  final asked = seededShuffle(audible, '$seed/asked').take(count).toList();
  return [
    for (final (i, item) in asked.indexed)
      EarQuestion(
        item: item,
        options: seededShuffle([
          item,
          ...seededShuffle([
            for (final o in pool)
              if (o.id != item.id && normalizeForCompare(o.text) != normalizeForCompare(item.text)) o,
          ], '$seed/others/$i').take(optionCount - 1),
        ], '$seed/options/$i'),
      ),
  ];
}

// --- Sentence dash: put the words of each sentence back in order, against the clock -------------------------------

class DashSentence {
  const DashSentence({required this.item, required this.answer, required this.distractors});

  final GameItem item;
  final List<String> answer;
  final List<String> distractors;
}

/// Whether [item] can be rebuilt from tiles: 3–7 words.
bool canDash(GameItem item) {
  final words = tileTokens(item.tileSource).length;
  return words >= 3 && words <= 7;
}

/// Up to [count] sentences of [pool] to rebuild, each with one word of another sentence mixed in.
List<DashSentence> dashSentences({required List<GameItem> pool, required Object seed, int count = 5}) {
  final buildable = pool.where(canDash).toList();
  final chosen = seededShuffle(buildable, '$seed/sentences').take(count).toList();
  return [
    for (final (i, item) in chosen.indexed)
      () {
        final answer = tileTokens(item.tileSource);
        final own = {for (final w in answer) normalizeForCompare(w)};
        final foreign = <String>{
          for (final o in buildable)
            if (o.id != item.id)
              for (final w in tileTokens(o.tileSource))
                if (!own.contains(normalizeForCompare(w)) && normalizeForCompare(w).isNotEmpty) w,
        }.toList();
        return DashSentence(item: item, answer: answer, distractors: seededShuffle(foreign, '$seed/extra/$i').take(1).toList());
      }(),
  ];
}

/// The tiles of [sentence], ready to be placed.
TilesState dashTiles(DashSentence sentence, Object seed) => TilesState.start(sentence.answer, sentence.distractors, '$seed/${sentence.item.id}');

// --- Records ------------------------------------------------------------------------------------------------------

/// The games, by their stable id (the key of their record).
enum GameKind {
  memory('memory', lowerIsBetter: true),
  quick('quick', lowerIsBetter: false),
  ear('ear', lowerIsBetter: false),
  dash('dash', lowerIsBetter: true);

  const GameKind(this.id, {required this.lowerIsBetter});

  final String id;

  /// A record is a low number (moves, seconds) rather than a high one (right answers).
  final bool lowerIsBetter;
}

/// Whether [score] beats [best] in [kind] (anything beats no record).
bool beats(GameKind kind, int score, int? best) => best == null || (kind.lowerIsBetter ? score < best : score > best);
