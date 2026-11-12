/// Learn-path plans (approved declination L1 + L3 inside N2, 2026-10-27), built from the real draft curriculum.
///
/// Each mission on the pathway gets a teaching block BEFORE its spoken steps, derived from the mission's own
/// expressions (`assets/content/chapters/<trackId>.json`, exported from `@langquest/curriculum`):
/// - a scene (L1): the mission's dialogue lines in blueprint-slot order; the character's lines are heard (device
///   voice when one exists for the variety), the learner's lines are shadowed out loud — no score;
/// - discovery cards (L3): every phrase the learner will say in this mission, one per card;
/// - practice (L3): pairs (phrase ↔ meaning) in rounds that fit the screen; then listen and choose the meaning
///   (hearing a phrase in the course's voice); read a meaning and choose the phrase that says it; complete a phrase
///   with its missing word; then one sentence rebuilt from tiles;
/// - the mission stop: each learner line of the dialogue as an exchange (the character's cue, or the meaning when
///   nobody speaks first), answered by choosing the taught reply, then saying it out loud.
/// Everything a mission asks for was taught in its own Learn stop first (owner direction "teach before test").
library;

import '../../core/content/content_models.dart';
import 'learn_logic.dart';

/// Strip a literal gloss ("(lit. …)", "(litt. …)") and a trailing usage clause (" — said to …") from a meaning,
/// keeping qualifiers the learner needs ("(to a man)"). Used where space is short: pair cards, prompts, options.
String shortMeaning(String meaning) {
  var text = meaning;
  final dash = text.indexOf(' — ');
  if (dash > 0) text = text.substring(0, dash);
  // The gloss is removed with the space before it; French spacing before ? ! : ; is left untouched.
  text = text.replaceAll(RegExp(r'\s*\((?:lit\.|litt\.)[^)]*\)'), '');
  return text.trim();
}

/// [shortMeaning] for use inside a question ("How do you say “Hello”?"): also without its final full stop.
String promptMeaning(String meaning) {
  final short = shortMeaning(meaning);
  return short.endsWith('.') && !short.endsWith('..') ? short.substring(0, short.length - 1) : short;
}

/// Lower-case, punctuation-free form used to compare phrases and tiles ("¿Me cobras?" == "me cobras").
String normalizeForCompare(String text) =>
    text.toLowerCase().replaceAll(RegExp(r'''[.,!?;:¿¡…«»"“”‘’()\[\]、。！？،؟—–-]'''), ' ').replaceAll(RegExp(r'\s+'), ' ').trim();

/// Split a sentence into tiles: whitespace-separated words without their leading/trailing punctuation.
List<String> tileTokens(String text) => [
  for (final raw in text.split(RegExp(r'\s+')))
    if (_trimPunctuation(raw).isNotEmpty) _trimPunctuation(raw),
];

String _trimPunctuation(String token) => token.replaceAll(RegExp(r'''^[.,!?;:¿¡…«»"“”‘’()\[\]、。！？،؟]+|[.,!?;:¿¡…«»"“”‘’()\[\]、。！？،؟]+$'''), '');

/// One line of the L1 scene.
class SceneLine {
  final Expression expression;
  final String speakerName;

  const SceneLine({required this.expression, required this.speakerName});

  bool get byLearner => expression.byLearner;
}

/// One exchange of the Mission stop: an optional character cue, the learner line to give, and three options.
class MissionExchange {
  /// The character line that prompts the reply, or null when the learner speaks first (the meaning is the prompt).
  final Expression? cue;
  final Expression answer;

  /// The answer and up to two other phrases of the same mission, in a stable per-exchange order.
  final List<Expression> options;

  const MissionExchange({required this.cue, required this.answer, required this.options});

  int get answerIndex => options.indexOf(answer);
}

/// A sentence to rebuild from tiles.
class TileChallenge {
  final Expression expression;

  /// The words in order (romanized for non-Latin scripts, as in the approved L3 mockup).
  final List<String> answer;
  final List<String> distractors;

  const TileChallenge({required this.expression, required this.answer, required this.distractors});
}

/// What a practice choice question asks.
enum ChoiceKind {
  /// Hear a phrase (read it when no voice can say it) and choose its meaning.
  listen,

  /// Read a meaning and choose the phrase that says it.
  reverse,

  /// Hear a phrase and choose it among three written ones (asked only where a voice can say it).
  hear,
}

/// A practice question about one taught phrase: three options (phrases of the same mission), one right. The
/// options are shown by their meaning ([ChoiceKind.listen]) or their text ([ChoiceKind.reverse], [ChoiceKind.hear]).
class ChoiceQuestion {
  final ChoiceKind kind;
  final Expression expression;

  /// The options, the right one among them, in a stable shuffled order.
  final List<Expression> options;

  const ChoiceQuestion({required this.kind, required this.expression, required this.options});

  int get answerIndex => options.indexOf(expression);
}

/// A taught phrase with one word missing ([words] is the phrase split into words: the romanization for non-Latin
/// scripts, like the tiles), and three words to choose from: the missing one and two from other taught phrases.
class GapChallenge {
  final Expression expression;
  final List<String> words;
  final int gap;
  final List<String> options;

  const GapChallenge({required this.expression, required this.words, required this.gap, required this.options});

  String get answer => words[gap];
  int get answerIndex => options.indexOf(answer);
}

class MissionLearnPlan {
  final Mission mission;
  final CourseTrackInfo track;

  /// Instruction language of the meanings shown.
  final String source;
  final StoryCharacter? character;
  final List<SceneLine> sceneLines;

  /// The learner phrases taught on the discovery cards (deduplicated by text).
  final List<Expression> phrases;

  /// Pairs-game rounds (≤ 5 pairs each so a round fits the screen; distinct meanings within the plan).
  final List<List<Expression>> pairRounds;
  final TileChallenge? tiles;
  final List<MissionExchange> exchanges;

  /// Practice choice questions, after the pairs: listen (hear → meaning), then reverse (meaning → phrase).
  final List<ChoiceQuestion> choices;

  /// Practice: complete a phrase with its missing word (before the tiles), when the mission has one to offer.
  final GapChallenge? gap;

  const MissionLearnPlan({
    required this.mission,
    required this.track,
    required this.source,
    required this.character,
    required this.sceneLines,
    required this.phrases,
    required this.pairRounds,
    required this.tiles,
    required this.exchanges,
    this.choices = const [],
    this.gap,
  });

  String? get voiceLocale => track.voiceLocale;
  String get characterName => character?.name ?? '';

  /// The phrases of the pairs game, in teaching order: one per distinct meaning, so any of them can be asked for by
  /// its meaning without a second right answer.
  List<Expression> get pairPhrases => [for (final round in pairRounds) ...round];

  /// Meaning of [e] in the course's instruction language (the exporter guarantees one per source language).
  String meaningOf(Expression e) => e.meaningIn(source)?.meaning ?? '';
  String shortMeaningOf(Expression e) => shortMeaning(meaningOf(e));
  String promptMeaningOf(Expression e) => promptMeaning(meaningOf(e));
  String? noteOf(Expression e) => e.meaningIn(source)?.note;

  /// The phrase word for word, in the instruction language, when the course gives it and it says more than the
  /// meaning itself.
  String? literalOf(Expression e) {
    final literal = e.meaningIn(source)?.literal;
    return literal == null || normalizeForCompare(literal) == normalizeForCompare(shortMeaningOf(e)) ? null : literal;
  }

  /// The text a learner builds tiles from: the romanization for non-Latin scripts, else the text itself.
  String tileSourceOf(Expression e) => track.usesRomanization ? (e.romanization ?? e.text) : e.text;
}

const _maxPairsPerRound = 5;
const _minTileWords = 3;
const _maxTileWords = 7;
const _choicesPerKind = 2;
const _minGapWords = 3;
const _maxGapWords = 9;

/// [items] keeping only the first of each intent, in order.
Iterable<Expression> _distinctIntents(Iterable<Expression> items) {
  final seen = <String>{};
  return items.where((e) => seen.add(e.intentKey));
}

/// Split [items] into the fewest rounds of at most [maxPerRound], as evenly as possible (7 → 4 + 3).
List<List<T>> evenRounds<T>(List<T> items, int maxPerRound) {
  if (items.isEmpty) return const [];
  final rounds = (items.length / maxPerRound).ceil();
  final base = items.length ~/ rounds;
  var extra = items.length % rounds;
  final out = <List<T>>[];
  var i = 0;
  for (var r = 0; r < rounds; r++) {
    final size = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    out.add(items.sublist(i, i + size));
    i += size;
  }
  return out;
}

/// Build the learn plan of [mission] for a learner taught from [source]. Pure and deterministic.
MissionLearnPlan buildLearnPlan({required Mission mission, required CourseTrackInfo track, required String source, StoryCharacter? character}) {
  String meaning(Expression e) => e.meaningIn(source)?.meaning ?? '';
  final characterName = character?.name ?? '';

  // L1 scene: the dialogue lines (expressions that fill a blueprint slot), in authored slot order.
  final slotted = [
    for (final e in mission.expressions)
      if (e.slotId != null) e,
  ];
  final dialogue = slotted.length >= 2 ? slotted : mission.expressions;
  final sceneLines = [for (final e in dialogue) SceneLine(expression: e, speakerName: e.byLearner ? '' : characterName)];

  // L3 cards: every phrase the learner says in this mission (dialogue lines first, then extra variants).
  final seenText = <String>{};
  final phrases = <Expression>[
    for (final e in [...dialogue.where((e) => e.byLearner), ...mission.learnerExpressions])
      if (seenText.add(normalizeForCompare(e.text))) e,
  ];

  // Pairs: one card per distinct meaning, so no round has two right answers.
  final seenMeaning = <String>{};
  final pairPhrases = [
    for (final e in phrases)
      if (meaning(e).isNotEmpty && seenMeaning.add(normalizeForCompare(shortMeaning(meaning(e))))) e,
  ];
  final pairRounds = evenRounds(pairPhrases, _maxPairsPerRound);

  // Tiles: the longest learner dialogue line of 3–7 words without a name placeholder.
  String tileSource(Expression e) => track.usesRomanization ? (e.romanization ?? '') : e.text;
  TileChallenge? tiles;
  final candidates = [
    for (final e in dialogue)
      if (e.byLearner && canBeBuilt(e, tileSource(e))) e,
  ];
  if (candidates.isNotEmpty) {
    var best = candidates.first;
    for (final e in candidates) {
      if (tileTokens(tileSource(e)).length > tileTokens(tileSource(best)).length) best = e;
    }
    tiles = tileChallenge(seed: '${mission.key}/tiles', expression: best, phrases: phrases, tileSource: tileSource);
  }

  // Mission exchanges: each learner dialogue line, cued by the character line right before it (if any).
  final exchanges = <MissionExchange>[];
  for (var i = 0; i < dialogue.length; i++) {
    final answer = dialogue[i];
    if (!answer.byLearner) continue;
    final previous = i > 0 ? dialogue[i - 1] : null;
    final cue = previous != null && !previous.byLearner ? previous : null;
    // A variant of the same intent ("Здравствуйте" / "Привет") would be a right answer too: never a distractor.
    final others = [
      for (final e in phrases)
        if (e != answer &&
            e.intentKey != answer.intentKey &&
            normalizeForCompare(e.text) != normalizeForCompare(answer.text) &&
            normalizeForCompare(shortMeaning(meaning(e))) != normalizeForCompare(shortMeaning(meaning(answer))))
          e,
    ];
    final distractors = _distinctIntents(stableShuffle(others, '${mission.key}/${answer.key}/distract', (e) => e.id)).take(2);
    final options = stableShuffle([answer, ...distractors], '${mission.key}/${answer.key}/options', (e) => e.id);
    exchanges.add(MissionExchange(cue: cue, answer: answer, options: options));
  }

  // Choice questions: phrases with distinct meanings and texts (the pair phrases), alternating listen / reverse so
  // the two kinds ask about different phrases; options are two other pair phrases.
  final choices = <ChoiceQuestion>[];
  if (pairPhrases.length >= 3) {
    final listen = [for (var i = 0; i < pairPhrases.length; i += 2) pairPhrases[i]].take(_choicesPerKind);
    final reverse = [for (var i = 1; i < pairPhrases.length; i += 2) pairPhrases[i]].take(_choicesPerKind);
    choices
      ..addAll([for (final e in listen) ?choiceQuestion(seed: mission.key, kind: ChoiceKind.listen, expression: e, pool: pairPhrases)])
      ..addAll([for (final e in reverse) ?choiceQuestion(seed: mission.key, kind: ChoiceKind.reverse, expression: e, pool: pairPhrases)]);
  }

  // Gap: a learner line other than the tiles' one, 3–9 words; its longest word (of 2+ letters) is missing.
  GapChallenge? gap;
  for (final e in phrases) {
    if (e == tiles?.expression) continue;
    gap = gapChallenge(seed: mission.key, expression: e, phrases: phrases, tileSource: tileSource);
    if (gap != null) break;
  }

  return MissionLearnPlan(
    mission: mission,
    track: track,
    source: source,
    character: character,
    sceneLines: sceneLines,
    phrases: phrases,
    pairRounds: pairRounds,
    tiles: tiles,
    exchanges: exchanges,
    choices: choices,
    gap: gap,
  );
}

/// Whether a phrase leaves something for the learner to fill in ("Me llamo …"): such a line is never rebuilt, typed
/// or completed.
bool hasPlaceholder(Expression expression, [String source = '']) =>
    expression.text.contains('…') || expression.text.contains('...') || source.contains('…') || source.contains('...');

/// Whether [expression] can be rebuilt from tiles made of [source] (its text, or its romanization for non-Latin
/// scripts): 3–7 words, no name placeholder.
bool canBeBuilt(Expression expression, String source) {
  if (hasPlaceholder(expression, source)) return false;
  final words = tileTokens(source).length;
  return words >= _minTileWords && words <= _maxTileWords;
}

/// [expression] to rebuild from tiles, with two words of the mission's other [phrases] that are not in it.
TileChallenge tileChallenge({
  required String seed,
  required Expression expression,
  required List<Expression> phrases,
  required String Function(Expression) tileSource,
}) {
  final answer = tileTokens(tileSource(expression));
  final answerNorm = {for (final w in answer) normalizeForCompare(w)};
  final pool = <String>{
    for (final e in phrases)
      if (e != expression)
        for (final w in tileTokens(tileSource(e)))
          if (!answerNorm.contains(normalizeForCompare(w)) && normalizeForCompare(w).isNotEmpty) w,
  }.toList();
  final distractors = stableShuffle(pool, seed, (w) => w).take(2).toList();
  return TileChallenge(expression: expression, answer: answer, distractors: distractors);
}

/// A question of [kind] about [expression], its two other options taken from [pool] (phrases with distinct
/// meanings). Options never share the asked phrase's intent, nor each other's: a variant ("Combien, les pommes ?"
/// next to "Combien coûtent ces pommes ?") would be a second right answer. Null when the pool cannot offer two.
ChoiceQuestion? choiceQuestion({required String seed, required ChoiceKind kind, required Expression expression, required List<Expression> pool}) {
  final candidates = [
    for (final o in pool)
      if (o != expression && o.intentKey != expression.intentKey && normalizeForCompare(o.text) != normalizeForCompare(expression.text)) o,
  ];
  final others = _distinctIntents(stableShuffle(candidates, '$seed/${expression.key}/${kind.name}', (o) => o.id)).take(2).toList();
  if (others.length < 2) return null;
  return ChoiceQuestion(
    kind: kind,
    expression: expression,
    options: stableShuffle([expression, ...others], '$seed/${expression.key}/${kind.name}/options', (o) => o.id),
  );
}

/// [expression] with its longest word (of 2+ letters) missing, and two words of the mission's other [phrases] to
/// choose from besides it. Null when the phrase is not 3–9 words, has a name placeholder, or nothing else to offer.
GapChallenge? gapChallenge({
  required String seed,
  required Expression expression,
  required List<Expression> phrases,
  required String Function(Expression) tileSource,
}) {
  final source = tileSource(expression);
  if (hasPlaceholder(expression, source)) return null;
  final words = tileTokens(source);
  if (words.length < _minGapWords || words.length > _maxGapWords) return null;
  var at = -1;
  for (var i = 0; i < words.length; i++) {
    if (normalizeForCompare(words[i]).length < 2) continue;
    if (at < 0 || words[i].length > words[at].length) at = i;
  }
  if (at < 0) return null;
  final inPhrase = {for (final w in words) normalizeForCompare(w)};
  // One candidate per word whatever its case or punctuation ("de" / "De"), none of the phrase's own words.
  final byForm = <String, String>{};
  for (final o in phrases) {
    if (o == expression) continue;
    for (final w in tileTokens(tileSource(o))) {
      final form = normalizeForCompare(w);
      if (form.length >= 2 && !inPhrase.contains(form)) byForm.putIfAbsent(form, () => w);
    }
  }
  final pool = byForm.values.toList();
  if (pool.length < 2) return null;
  final distractors = stableShuffle(pool, '$seed/${expression.key}/gap', (w) => w).take(2);
  return GapChallenge(
    expression: expression,
    words: words,
    gap: at,
    options: stableShuffle([words[at], ...distractors], '$seed/${expression.key}/gap/options', (w) => w),
  );
}
