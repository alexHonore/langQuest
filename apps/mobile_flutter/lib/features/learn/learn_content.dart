/// Learn-path plans (approved declination L1 + L3 inside N2, 2026-10-27), built from the real draft curriculum.
///
/// Each mission on the pathway gets a teaching block BEFORE its spoken steps, derived from the mission's own
/// expressions (`assets/content/chapters.json`, exported from `@langquest/curriculum`):
/// - a scene (L1): the mission's dialogue lines in blueprint-slot order; the character's lines are heard (device
///   voice when one exists for the variety), the learner's lines are shadowed out loud — no score;
/// - discovery cards (L3): every phrase the learner will say in this mission, one per card;
/// - practice (L3): pairs (phrase ↔ meaning) in rounds that fit the screen, then one sentence rebuilt from tiles;
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
  });

  String? get voiceLocale => track.voiceLocale;
  String get characterName => character?.name ?? '';

  /// Meaning of [e] in the course's instruction language (the exporter guarantees one per source language).
  String meaningOf(Expression e) => e.meaningIn(source)?.meaning ?? '';
  String shortMeaningOf(Expression e) => shortMeaning(meaningOf(e));
  String promptMeaningOf(Expression e) => promptMeaning(meaningOf(e));
  String? noteOf(Expression e) => e.meaningIn(source)?.note;

  /// The text a learner builds tiles from: the romanization for non-Latin scripts, else the text itself.
  String tileSourceOf(Expression e) => track.usesRomanization ? (e.romanization ?? e.text) : e.text;
}

const _maxPairsPerRound = 5;
const _minTileWords = 3;
const _maxTileWords = 7;

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
      if (e.byLearner &&
          !e.text.contains('…') &&
          !e.text.contains('...') &&
          tileTokens(tileSource(e)).length >= _minTileWords &&
          tileTokens(tileSource(e)).length <= _maxTileWords)
        e,
  ];
  if (candidates.isNotEmpty) {
    var best = candidates.first;
    for (final e in candidates) {
      if (tileTokens(tileSource(e)).length > tileTokens(tileSource(best)).length) best = e;
    }
    final answer = tileTokens(tileSource(best));
    final answerNorm = {for (final w in answer) normalizeForCompare(w)};
    final pool = <String>{
      for (final e in phrases)
        if (e != best)
          for (final w in tileTokens(tileSource(e)))
            if (!answerNorm.contains(normalizeForCompare(w)) && normalizeForCompare(w).isNotEmpty) w,
    }.toList();
    final distractors = stableShuffle(pool, '${mission.key}/tiles', (w) => w).take(2).toList();
    tiles = TileChallenge(expression: best, answer: answer, distractors: distractors);
  }

  // Mission exchanges: each learner dialogue line, cued by the character line right before it (if any).
  final exchanges = <MissionExchange>[];
  for (var i = 0; i < dialogue.length; i++) {
    final answer = dialogue[i];
    if (!answer.byLearner) continue;
    final previous = i > 0 ? dialogue[i - 1] : null;
    final cue = previous != null && !previous.byLearner ? previous : null;
    final others = [
      for (final e in phrases)
        if (e != answer &&
            normalizeForCompare(e.text) != normalizeForCompare(answer.text) &&
            normalizeForCompare(shortMeaning(meaning(e))) != normalizeForCompare(shortMeaning(meaning(answer))))
          e,
    ];
    final distractors = stableShuffle(others, '${mission.key}/${answer.key}/distract', (e) => e.id).take(2);
    final options = stableShuffle([answer, ...distractors], '${mission.key}/${answer.key}/options', (e) => e.id);
    exchanges.add(MissionExchange(cue: cue, answer: answer, options: options));
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
  );
}
