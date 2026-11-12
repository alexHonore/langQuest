import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/backend/server_voice.dart';
import '../../core/content/content_models.dart';
import '../../core/services/app_state.dart';
import '../../core/services/learner_state.dart';
import '../../core/services/learner_store.dart';
import '../learn/learn_content.dart';
import '../learn/learn_logic.dart';
import '../learn/learn_providers.dart';
import 'game_logic.dart';

/// A phrase in play: the course's expression (for its script, its reading aids and its voice) and what a game needs
/// of it.
class GamePhrase {
  const GamePhrase({required this.expression, required this.item});

  final Expression expression;
  final GameItem item;
}

/// Games open once this many phrases have been taught: enough for a board and for wrong answers to choose among.
const minGamePhrases = 4;

/// What the games need of [plan]'s phrases: one per meaning (the pairs' phrases), in teaching order.
List<GamePhrase> gamePhrasesOf(MissionLearnPlan plan) => [
  for (final e in plan.pairPhrases)
    GamePhrase(
      expression: e,
      item: GameItem(
        id: e.id,
        text: e.text,
        meaning: plan.shortMeaningOf(e),
        intent: e.intentKey,
        tileSource: hasPlaceholder(e, plan.tileSourceOf(e)) ? '' : plan.tileSourceOf(e),
      ),
    ),
];

/// Whether [plan]'s mission has a Play stop: enough phrases of its own for a board of Lantern pairs (the game every
/// mission can fall back on).
bool planHasGame(MissionLearnPlan plan) => plan.pairPhrases.length >= minMemoryPhrases;

/// The phrases a mission's Play stop is played with: the mission's own, whatever else was learned.
final missionGamePoolProvider = Provider.family<List<GamePhrase>, String>((ref, missionKey) {
  final plan = ref.watch(learnPlanProvider(missionKey));
  return plan == null ? const [] : gamePhrasesOf(plan);
});

/// The phrases a round is played with: a mission's own for its Play stop, everything learned on the Play tab (null).
final roundPoolProvider = Provider.autoDispose.family<List<GamePhrase>, String?>(
  (ref, missionKey) => missionKey == null ? ref.watch(gamePoolProvider) : ref.watch(missionGamePoolProvider(missionKey)),
);

/// Those of a round's phrases that can be said here (their bundled clip, or a voice for the course).
final audibleRoundPoolProvider = Provider.autoDispose.family<List<GamePhrase>, String?>((ref, missionKey) {
  final pool = ref.watch(roundPoolProvider(missionKey));
  final locale = ref.watch(appStateProvider.select((s) => s.activeCourse?.track.voiceLocale));
  final voice = ref.watch(lineVoiceNowProvider(locale));
  if (voice == null) return const [];
  return [
    for (final p in pool)
      if (voice.canSay(expressionId: p.expression.id)) p,
  ];
});

/// The game of [missionKey]'s Play stop: the games take turns from mission to mission, each with the mission's own
/// phrases. Null when the mission has too few phrases for any (no Play stop then).
final missionGameProvider = Provider.autoDispose.family<GameKind?, String>((ref, missionKey) {
  final course = ref.watch(appStateProvider.select((s) => s.activeCourse));
  final index = course?.indexOfMission(missionKey) ?? -1;
  if (index < 0) return null;
  final pool = ref.watch(missionGamePoolProvider(missionKey));
  return missionGameFor(index, gamesPlayableWith([for (final p in pool) p.item], audible: ref.watch(audibleRoundPoolProvider(missionKey)).length));
});

/// The phrases the games play with: those of the missions whose Learn stop is done in the active course, in course
/// order — nothing the learner has not been taught (teach before test). One phrase per text and per meaning, so a
/// card or an answer never has a twin.
final gamePoolProvider = Provider<List<GamePhrase>>((ref) {
  final courseId = ref.watch(activeCourseIdProvider);
  if (courseId == null) return const [];
  final course = ref.watch(appStateProvider.select((s) => s.activeCourse));
  final stops = ref.watch(appStateProvider.select((s) => s.progress.stops));
  if (course == null) return const [];
  final texts = <String>{};
  final meanings = <String>{};
  final pool = <GamePhrase>[];
  for (final mission in course.missions) {
    if (!(stops[mission.key]?.contains(PathStop.learn) ?? false)) continue;
    final plan = ref.watch(learnPlanProvider(mission.key));
    if (plan == null) continue;
    for (final phrase in gamePhrasesOf(plan)) {
      if (!texts.add(normalizeForCompare(phrase.item.text)) || !meanings.add(normalizeForCompare(phrase.item.meaning))) continue;
      pool.add(phrase);
    }
  }
  return pool;
});

/// Whether there is enough to play with (the games are shown only then: visible means usable).
final gamesAvailableProvider = Provider<bool>((ref) => ref.watch(gamePoolProvider).length >= minGamePhrases);

/// What the learner did in one game, in one course, on this device.
class GameRecord {
  const GameRecord({this.plays = 0, this.best, this.lastXpDay});

  factory GameRecord.fromJson(Object? json) {
    if (json is! Map) return const GameRecord();
    return GameRecord(
      plays: (json['plays'] as num?)?.toInt() ?? 0,
      best: (json['best'] as num?)?.toInt(),
      lastXpDay: json['lastXpDay'] is String ? json['lastXpDay'] as String : null,
    );
  }

  /// Rounds played to the end.
  final int plays;

  /// The best round: fewest moves or seconds, or most right answers ([GameKind.lowerIsBetter]).
  final int? best;

  /// The last day a round of this game earned XP (one round a day does).
  final String? lastXpDay;

  Map<String, Object?> toJson() => {'plays': plays, 'best': best, 'lastXpDay': lastXpDay};
}

/// What a finished round came to.
typedef GameOutcome = ({bool record, bool xp});

/// The games' records, per course and game (and per board size where a record depends on it), kept on the device.
class GameStats extends Notifier<Map<String, GameRecord>> {
  static const key = 'langquest.games.v1';

  @override
  Map<String, GameRecord> build() {
    try {
      final raw = jsonDecode(ref.read(learnerStoreProvider).prefs.getString(key) ?? '{}');
      if (raw is Map) return {for (final e in raw.entries) '${e.key}': GameRecord.fromJson(e.value)};
    } catch (_) {}
    return {};
  }

  static String _id(String courseId, GameKind kind, String variant) => '$courseId/${kind.id}${variant.isEmpty ? '' : ':$variant'}';

  GameRecord recordOf(String courseId, GameKind kind, {String variant = ''}) => state[_id(courseId, kind, variant)] ?? const GameRecord();

  /// A round played to the end with [score]: counted, kept as the best when it is, and paid in XP once a day per
  /// game (XP measures practice; a game is practice).
  GameOutcome finished(String courseId, GameKind kind, int score, {String variant = ''}) {
    final id = _id(courseId, kind, variant);
    final before = state[id] ?? const GameRecord();
    final today = dayKey(ref.read(clockProvider)());
    // The XP day is per game, whatever the board: the first round of a game each day.
    final xpId = _id(courseId, kind, '');
    final paid = (state[xpId] ?? const GameRecord()).lastXpDay == today;
    final record = beats(kind, score, before.best);
    final next = {...state};
    next[id] = GameRecord(plays: before.plays + 1, best: record ? score : before.best, lastXpDay: before.lastXpDay);
    final xpBefore = next[xpId] ?? const GameRecord();
    next[xpId] = GameRecord(plays: xpBefore.plays, best: xpBefore.best, lastXpDay: today);
    state = next;
    unawaited(ref.read(learnerStoreProvider).prefs.setString(key, jsonEncode({for (final e in state.entries) e.key: e.value.toJson()})));
    if (!paid) ref.read(appStateProvider.notifier).gameRoundPlayed();
    return (record: record && before.best != null, xp: !paid);
  }

  /// Everything, for "Reset all progress".
  void clear() {
    state = {};
    unawaited(ref.read(learnerStoreProvider).prefs.remove(key));
  }
}

final gameStatsProvider = NotifierProvider<GameStats, Map<String, GameRecord>>(GameStats.new);
