/// The Practise stop as a session: what is asked, in which order, and what happens to an answer. Pure Dart, built
/// from a mission's own learn plan (`learn_content.dart`), unit-tested in `test/practice_session_test.dart`.
///
/// A session goes from recognising to producing, so a phrase is met several times in different ways:
/// - two questions about earlier missions first, when there are any (what was learned before comes back);
/// - the pairs (phrase ↔ meaning), then questions about the phrases just matched: hear it and choose its meaning,
///   and "is this what it means?";
/// - a meaning to find the phrase for, and a phrase to recognise by ear among three written ones;
/// - a phrase to complete, a sentence to build from its meaning, another to build from what is heard;
/// - for Latin-script courses, a short phrase to type.
/// One answer per question: a wrong one shows the right answer, and the question comes back once at the end of the
/// session. Nothing is scored; the session only remembers what was right the first time, to say what to look at again.
library;

import '../../core/content/content_models.dart';
import 'learn_content.dart';
import 'learn_logic.dart';

/// One step of a practice session.
sealed class PracticeStep {
  const PracticeStep({this.retry = false});

  /// Asked again at the end of the session because the first answer was wrong.
  final bool retry;

  /// Stable within a session (a retry keeps the id of the step it repeats).
  String get id;

  /// The phrase the step asks about; null for the pairs, which ask about several.
  Expression? get subject;

  /// The same step, to ask again at the end.
  PracticeStep asRetry();
}

/// Match each phrase of [pairs] with its meaning.
class PairsStep extends PracticeStep {
  const PairsStep(this.round, this.pairs);

  final int round;
  final List<Expression> pairs;

  @override
  String get id => 'pairs/$round';

  @override
  Expression? get subject => null;

  @override
  PracticeStep asRetry() => this;
}

/// Three options, one right: by ear or by meaning ([ChoiceQuestion.kind]).
class ChoiceStep extends PracticeStep {
  const ChoiceStep(this.question, {this.earlier = false, super.retry});

  final ChoiceQuestion question;

  /// About a phrase of an earlier mission.
  final bool earlier;

  @override
  String get id => 'choice/${question.kind.name}/${question.expression.id}';

  @override
  Expression get subject => question.expression;

  @override
  PracticeStep asRetry() => ChoiceStep(question, earlier: earlier, retry: true);
}

/// A phrase and a meaning: is it what the phrase means?
class TrueFalseStep extends PracticeStep {
  const TrueFalseStep(this.expression, this.shown, {super.retry});

  final Expression expression;

  /// The phrase whose meaning is shown: [expression] itself, or another one.
  final Expression shown;

  bool get isTrue => identical(expression, shown);

  @override
  String get id => 'truefalse/${expression.id}';

  @override
  Expression get subject => expression;

  @override
  PracticeStep asRetry() => TrueFalseStep(expression, shown, retry: true);
}

/// A phrase with one word missing.
class GapStep extends PracticeStep {
  const GapStep(this.gap, {super.retry});

  final GapChallenge gap;

  @override
  String get id => 'gap/${gap.expression.id}';

  @override
  Expression get subject => gap.expression;

  @override
  PracticeStep asRetry() => GapStep(gap, retry: true);
}

/// A sentence to build from tiles: from its meaning, or ([byEar]) from what is heard.
class BuildStep extends PracticeStep {
  const BuildStep(this.tiles, {this.byEar = false, super.retry});

  final TileChallenge tiles;
  final bool byEar;

  @override
  String get id => 'build/${byEar ? 'ear' : 'meaning'}/${tiles.expression.id}';

  @override
  Expression get subject => tiles.expression;

  @override
  PracticeStep asRetry() => BuildStep(tiles, byEar: byEar, retry: true);
}

/// A phrase to type from its meaning (Latin-script courses).
class TypeStep extends PracticeStep {
  const TypeStep(this.expression, {super.retry});

  final Expression expression;

  @override
  String get id => 'type/${expression.id}';

  @override
  Expression get subject => expression;

  @override
  PracticeStep asRetry() => TypeStep(expression, retry: true);
}

const _listenQuestions = 2;
const _trueFalseQuestions = 2;
const _reverseQuestions = 2;
const _gaps = 2;
const _earlierQuestions = 2;
const _maxTypedWords = 4;
const _maxTypedLength = 28;

/// The steps of [plan]'s practice. [earlier]: the plans of the missions the learner completed before this one, in
/// course order (their phrases open the session). [canHear]: whether a phrase can be said here (its clip, or a voice
/// for the course); questions that only make sense by ear are asked about those phrases only. Deterministic.
List<PracticeStep> buildPracticeSession(MissionLearnPlan plan, {List<MissionLearnPlan> earlier = const [], bool Function(Expression)? canHear}) {
  final key = plan.mission.key;
  final pool = plan.pairPhrases;
  final rounds = plan.pairRounds;
  final hears = canHear ?? (_) => false;
  String tileSource(Expression e) => plan.track.usesRomanization ? (e.romanization ?? '') : e.text;

  // How often each phrase was asked so far: the next question goes to one of the least asked.
  final asked = <String, int>{};
  Expression? pick(String slot, bool Function(Expression) ok) {
    Expression? best;
    for (final e in stableShuffle(pool.where(ok).toList(), '$key/session/$slot', (e) => e.id)) {
      if (best == null || (asked[e.id] ?? 0) < (asked[best.id] ?? 0)) best = e;
    }
    if (best != null) asked[best.id] = (asked[best.id] ?? 0) + 1;
    return best;
  }

  final steps = <PracticeStep>[];
  final used = <String>{};
  void add(PracticeStep? step) {
    if (step != null && used.add(step.id)) steps.add(step);
  }

  // What was learned before comes back first: the most recent missions, one question by ear and one by meaning.
  final recent = earlier.reversed.where((p) => p.pairPhrases.length >= 3).take(_earlierQuestions).toList();
  for (var i = 0; i < _earlierQuestions && recent.isNotEmpty; i++) {
    final from = recent[i % recent.length];
    final phrases = stableShuffle(from.pairPhrases, '$key/earlier/${from.mission.key}', (e) => e.id);
    final question = choiceQuestion(
      seed: '$key/earlier',
      kind: i.isEven ? ChoiceKind.listen : ChoiceKind.reverse,
      expression: phrases[(i ~/ recent.length) % phrases.length],
      pool: from.pairPhrases,
    );
    add(question == null ? null : ChoiceStep(question, earlier: true));
  }

  // Recognise: the first pairs, then the phrases just matched, by ear and by "is this what it means?".
  if (rounds.isNotEmpty) add(PairsStep(0, rounds.first));
  bool justMatched(Expression e) => rounds.isEmpty || rounds.first.contains(e);
  for (var i = 0; i < _listenQuestions; i++) {
    final e = pick('listen/$i', justMatched);
    final question = e == null ? null : choiceQuestion(seed: key, kind: ChoiceKind.listen, expression: e, pool: pool);
    add(question == null ? null : ChoiceStep(question));
  }
  final firstIsTrue = stableHash('$key/truefalse').isEven;
  for (var i = 0; i < _trueFalseQuestions && pool.length >= 2; i++) {
    final e = pick('truefalse/$i', justMatched);
    if (e == null) continue;
    final others = stableShuffle(
      [
        for (final o in pool)
          if (o != e && o.intentKey != e.intentKey) o,
      ],
      '$key/truefalse/${e.key}',
      (o) => o.id,
    );
    final isTrue = others.isEmpty || (i.isEven ? firstIsTrue : !firstIsTrue);
    add(TrueFalseStep(e, isTrue ? e : others.first));
  }

  // Recall: the other pairs, then from a meaning to its phrase, and a phrase recognised by ear.
  for (var r = 1; r < rounds.length; r++) {
    add(PairsStep(r, rounds[r]));
  }
  for (var i = 0; i < _reverseQuestions; i++) {
    final e = pick('reverse/$i', (_) => true);
    final question = e == null ? null : choiceQuestion(seed: key, kind: ChoiceKind.reverse, expression: e, pool: pool);
    add(question == null ? null : ChoiceStep(question));
  }
  final heard = pick('hear', hears);
  if (heard != null) {
    final question = choiceQuestion(seed: key, kind: ChoiceKind.hear, expression: heard, pool: pool);
    add(question == null ? null : ChoiceStep(question));
  }

  // Produce: complete a phrase, build a sentence from its meaning, then one from what is heard.
  final built = plan.tiles;
  final gaps = <String, GapChallenge>{
    for (final e in plan.phrases)
      if (e != built?.expression) e.id: ?gapChallenge(seed: key, expression: e, phrases: plan.phrases, tileSource: tileSource),
  };
  // The least asked first, in an order of their own among equals (a sort is not stable on every platform).
  final gapOrder = stableShuffle(
    [
      for (final e in plan.phrases)
        if (gaps.containsKey(e.id)) e,
    ],
    '$key/session/gap',
    (e) => e.id,
  );
  final gapPhrases = [
    for (var count = 0; count <= asked.values.fold(0, (a, b) => a > b ? a : b); count++)
      for (final e in gapOrder)
        if ((asked[e.id] ?? 0) == count) e,
  ];
  for (final e in gapPhrases.take(_gaps)) {
    asked[e.id] = (asked[e.id] ?? 0) + 1;
    add(GapStep(gaps[e.id]!));
  }
  if (built != null) {
    asked[built.expression.id] = (asked[built.expression.id] ?? 0) + 1;
    add(BuildStep(built));
  }
  final byEar = [
    for (final e in stableShuffle(plan.phrases, '$key/session/ear', (e) => e.id))
      if (e != built?.expression && hears(e) && canBeBuilt(e, tileSource(e))) e,
  ];
  if (byEar.isNotEmpty) {
    final e = byEar.first;
    add(BuildStep(tileChallenge(seed: '$key/ear', expression: e, phrases: plan.phrases, tileSource: tileSource), byEar: true));
  }

  // Write: a short phrase, where the keyboard writes the course's script.
  if (plan.track.primaryScript == 'Latn') {
    final e = pick('type', (e) => !hasPlaceholder(e) && tileTokens(e.text).length <= _maxTypedWords && e.text.length <= _maxTypedLength);
    add(e == null ? null : TypeStep(e));
  }
  return steps;
}

/// Where a learner is in a session, and what was right the first time. Immutable.
class PracticeProgress {
  const PracticeProgress._(this.queue, this.index, this.firstTry);

  PracticeProgress.start(List<PracticeStep> steps) : this._(List.unmodifiable(steps), 0, const {});

  /// The steps, with those to ask again appended as they are missed.
  final List<PracticeStep> queue;
  final int index;

  /// Per question (step id): whether its first answer was right.
  final Map<String, bool> firstTry;

  bool get finished => index >= queue.length;
  PracticeStep get current => queue[index.clamp(0, queue.length - 1)];

  /// Share of the session done, 0–1.
  double get fraction => queue.isEmpty ? 1 : (index / queue.length).clamp(0.0, 1.0);

  /// The answer to the current question. Wrong the first time: the question returns once, at the end ([again];
  /// off for a step the learner keeps working on until it is right, like a sentence to build).
  PracticeProgress answered(bool correct, {bool again = true}) {
    if (finished) return this;
    final step = current;
    if (step.subject == null) return this;
    final first = !firstTry.containsKey(step.id);
    return PracticeProgress._(
      !correct && first && again && !step.retry ? List.unmodifiable([...queue, step.asRetry()]) : queue,
      index,
      first ? {...firstTry, step.id: correct} : firstTry,
    );
  }

  PracticeProgress next() => finished ? this : PracticeProgress._(queue, index + 1, firstTry);

  /// Questions asked so far, and how many were right the first time.
  int get questions => firstTry.length;
  int get rightFirstTime => firstTry.values.where((right) => right).length;

  /// The phrases of the questions missed the first time, each once, in the order they were asked.
  List<Expression> get toRevisit {
    final seen = <String>{};
    return [
      for (final step in queue)
        if (!step.retry && firstTry[step.id] == false && step.subject != null && seen.add(step.subject!.id)) step.subject!,
    ];
  }
}

// --- Typed answers --------------------------------------------------------------------------------------------

/// How a typed phrase compares with the expected one.
enum TypedVerdict {
  /// The phrase, whatever its case and punctuation.
  exact,

  /// The phrase without (some of) its accents: accepted, and the accents are shown.
  accents,

  /// One letter off (two in a long phrase): accepted, and the spelling is shown.
  typo,

  wrong,
}

const _folds = {
  'a': 'áàâäãåāăạảấầẩẫậắằẳẵặ',
  'c': 'çćč',
  'd': 'đď',
  'e': 'éèêëēėęěẹẻẽếềểễệɛ',
  'i': 'íìîïīįịỉĩı',
  'n': 'ñńň',
  'o': 'óòôöõøōőọỏốồổỗộơớờởỡợɔ',
  's': 'śšș',
  't': 'țť',
  'u': 'úùûüūůűụủũưứừửữự',
  'y': 'ýÿỳỵỷỹ',
  'z': 'źżž',
  'ae': 'æ',
  'oe': 'œ',
  'ss': 'ß',
  'l': 'ł',
  'r': 'ř',
  'g': 'ğ',
};

final Map<int, String> _foldByRune = {
  for (final entry in _folds.entries)
    for (final rune in entry.value.runes) rune: entry.key,
};

/// [text] in lower case without its accents (`¿Qué tal?` → `¿que tal?`), for a lenient comparison.
String foldDiacritics(String text) {
  final out = StringBuffer();
  for (final rune in text.toLowerCase().runes) {
    // Combining marks (a decomposed "é" is "e" + U+0301) are dropped.
    if (rune >= 0x0300 && rune <= 0x036F) continue;
    out.write(_foldByRune[rune] ?? String.fromCharCode(rune));
  }
  return out.toString();
}

/// Levenshtein distance between [a] and [b], by code unit.
int editDistance(String a, String b) {
  if (a == b) return 0;
  if (a.isEmpty) return b.length;
  if (b.isEmpty) return a.length;
  var previous = List<int>.generate(b.length + 1, (i) => i);
  for (var i = 0; i < a.length; i++) {
    final current = List<int>.filled(b.length + 1, i + 1);
    for (var j = 0; j < b.length; j++) {
      final substitution = previous[j] + (a.codeUnitAt(i) == b.codeUnitAt(j) ? 0 : 1);
      final insertion = current[j] + 1;
      final deletion = previous[j + 1] + 1;
      current[j + 1] = substitution < insertion ? (substitution < deletion ? substitution : deletion) : (insertion < deletion ? insertion : deletion);
    }
    previous = current;
  }
  return previous[b.length];
}

/// Compares what was typed with the phrase: case, punctuation and spacing never count; missing accents and a slip
/// of the finger are accepted and pointed out, so the learner sees the exact spelling without being failed for it.
TypedVerdict checkTyped(String input, String answer) {
  final typed = normalizeForCompare(input);
  final expected = normalizeForCompare(answer);
  if (typed.isEmpty) return TypedVerdict.wrong;
  if (typed == expected) return TypedVerdict.exact;
  final typedPlain = foldDiacritics(typed);
  final expectedPlain = foldDiacritics(expected);
  if (typedPlain == expectedPlain) return TypedVerdict.accents;
  final allowed = expectedPlain.length >= 12 ? 2 : (expectedPlain.length >= 5 ? 1 : 0);
  if (allowed > 0 && editDistance(typedPlain, expectedPlain) <= allowed) return TypedVerdict.typo;
  return TypedVerdict.wrong;
}
