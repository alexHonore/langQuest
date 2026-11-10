/// Spaced repetition: a Dart port of the API's FSRS-like scheduler (`packages/curriculum/src/scheduler/`,
/// spec §3.5) with the same default parameters (`DEFAULT_SCHEDULER_PARAMS`), so a review scheduled on the phone
/// lands on the same day the server would pick. `test/srs_test.dart` checks it against vectors produced by the
/// TypeScript implementation.
library;

import 'dart:math' as math;

import 'seeded_random.dart';

enum ReviewRating { again, hard, good, easy }

/// `new` is the JSON name of [CardState.fresh] (a Dart keyword).
enum CardState { fresh, learning, review, relearning }

const _cardStateJson = {CardState.fresh: 'new', CardState.learning: 'learning', CardState.review: 'review', CardState.relearning: 'relearning'};

const _msPerDay = 86400000;

/// FSRS-4.5 published default weights (17), as in `fsrs.ts`.
const defaultWeights = <double>[
  0.4072,
  1.1829,
  3.1262,
  15.4722,
  7.2102,
  0.5316,
  1.0651,
  0.0234,
  1.616,
  0.1544,
  1.0824,
  1.9813,
  0.0953,
  0.2975,
  2.2042,
  0.2407,
  2.9466,
];

const _decay = -0.5;
const _factor = 19 / 81;
const _minStability = 0.01;

int _grade(ReviewRating r) => r.index + 1;
double _clampDifficulty(double d) => math.min(10, math.max(1, d));

/// JavaScript `Math.round` (half rounds up), for positive and negative values alike.
int jsRound(double x) => (x + 0.5).floor();

class MemoryState {
  final double stability;
  final double difficulty;
  const MemoryState({required this.stability, required this.difficulty});
}

class MemoryModel {
  final List<double> weights;
  const MemoryModel([this.weights = defaultWeights]);

  double _w(int i) => i < weights.length ? weights[i] : defaultWeights[i];

  double retrievability(double elapsedDays, double stability) {
    if (stability <= 0) return 0;
    return math.pow(1 + (_factor * math.max(0, elapsedDays)) / stability, _decay).toDouble();
  }

  double intervalForRetention(double stability, double desiredRetention) {
    final r = math.min(0.99, math.max(0.01, desiredRetention));
    return (stability / _factor) * (math.pow(r, 1 / _decay) - 1);
  }

  double initialStability(ReviewRating rating) => math.max(_minStability, _w(_grade(rating) - 1));
  double initialDifficulty(ReviewRating rating) => _clampDifficulty(_w(4) - (_grade(rating) - 3) * _w(5));

  double nextDifficulty(double difficulty, ReviewRating rating) {
    final raw = difficulty - _w(6) * (_grade(rating) - 3);
    return _clampDifficulty(_w(7) * initialDifficulty(ReviewRating.good) + (1 - _w(7)) * raw);
  }

  double nextRecallStability(double difficulty, double stability, double r, ReviewRating rating) {
    final hardPenalty = rating == ReviewRating.hard ? _w(15) : 1.0;
    final easyBonus = rating == ReviewRating.easy ? _w(16) : 1.0;
    final growth = math.exp(_w(8)) * (11 - difficulty) * math.pow(stability, -_w(9)) * (math.exp(_w(10) * (1 - r)) - 1) * hardPenalty * easyBonus;
    return math.max(_minStability, stability * (growth + 1));
  }

  double nextForgetStability(double difficulty, double stability, double r) {
    final s = _w(11) * math.pow(difficulty, -_w(12)) * (math.pow(stability + 1, _w(13)) - 1) * math.exp(_w(14) * (1 - r));
    return math.max(_minStability, math.min(s, stability));
  }

  MemoryState initial(ReviewRating rating) => MemoryState(stability: initialStability(rating), difficulty: initialDifficulty(rating));

  MemoryState next(MemoryState memory, double elapsedDays, ReviewRating rating) {
    final r = retrievability(elapsedDays, memory.stability);
    final difficulty = nextDifficulty(memory.difficulty, rating);
    final stability = rating == ReviewRating.again
        ? nextForgetStability(memory.difficulty, memory.stability, r)
        : nextRecallStability(memory.difficulty, memory.stability, r, rating);
    return MemoryState(stability: stability, difficulty: difficulty);
  }
}

/// One expression's review schedule. [id] is the expression id.
class ReviewCard {
  final String id;
  final CardState state;
  final double stability;
  final double difficulty;
  final DateTime due;
  final DateTime? lastReviewedAt;
  final int reps;
  final int lapses;
  final double scheduledDays;
  final double elapsedDays;

  const ReviewCard({
    required this.id,
    required this.state,
    required this.stability,
    required this.difficulty,
    required this.due,
    required this.lastReviewedAt,
    required this.reps,
    required this.lapses,
    required this.scheduledDays,
    required this.elapsedDays,
  });

  /// A brand-new card (state `new`, due now), as `newCard()` in the scheduler.
  factory ReviewCard.fresh(String id, DateTime now) => ReviewCard(
    id: id,
    state: CardState.fresh,
    stability: 0,
    difficulty: 5,
    due: now,
    lastReviewedAt: null,
    reps: 0,
    lapses: 0,
    scheduledDays: 0,
    elapsedDays: 0,
  );

  MemoryState get memory => MemoryState(stability: stability, difficulty: difficulty);

  bool isDue(DateTime now) => !due.isAfter(now);

  Map<String, Object?> toJson() => {
    'id': id,
    'state': _cardStateJson[state],
    'stability': stability,
    'difficulty': difficulty,
    'due': due.toUtc().toIso8601String(),
    'lastReviewedAt': lastReviewedAt?.toUtc().toIso8601String(),
    'reps': reps,
    'lapses': lapses,
    'scheduledDays': scheduledDays,
    'elapsedDays': elapsedDays,
  };

  /// Parses a stored card; returns null for an unreadable entry (it is dropped rather than crashing the app).
  static ReviewCard? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final json = raw.cast<String, Object?>();
    final state = _cardStateJson.entries.where((e) => e.value == json['state']).map((e) => e.key).firstOrNull;
    final due = DateTime.tryParse('${json['due']}');
    if (state == null || due == null || json['id'] is! String) return null;
    final last = json['lastReviewedAt'];
    return ReviewCard(
      id: json['id'] as String,
      state: state,
      stability: (json['stability'] as num?)?.toDouble() ?? 0,
      difficulty: (json['difficulty'] as num?)?.toDouble() ?? 5,
      due: due,
      lastReviewedAt: last is String ? DateTime.tryParse(last) : null,
      reps: (json['reps'] as num?)?.toInt() ?? 0,
      lapses: (json['lapses'] as num?)?.toInt() ?? 0,
      scheduledDays: (json['scheduledDays'] as num?)?.toDouble() ?? 0,
      elapsedDays: (json['elapsedDays'] as num?)?.toDouble() ?? 0,
    );
  }
}

class SchedulerParams {
  final double desiredRetention;
  final int maximumIntervalDays;
  final List<double> learningStepsMinutes;
  final List<double> relearningStepsMinutes;
  final double fuzzFactor;

  /// `DEFAULT_SCHEDULER_PARAMS` of `@langquest/contracts`.
  const SchedulerParams({
    this.desiredRetention = 0.9,
    this.maximumIntervalDays = 365,
    this.learningStepsMinutes = const [1, 10],
    this.relearningStepsMinutes = const [10],
    this.fuzzFactor = 0.05,
  });
}

class ReviewResult {
  final ReviewCard card;
  final double intervalDays;
  const ReviewResult(this.card, this.intervalDays);
}

/// Deterministic ±fuzz so reviews do not pile up on one day (`fuzzInterval`).
double fuzzInterval(double intervalDays, double fuzzFactor, String seedKey) {
  if (fuzzFactor <= 0 || intervalDays < 2.5) return intervalDays;
  final rnd = Seeded(seedKey).range(-1, 1);
  return math.max(1, intervalDays * (1 + rnd * fuzzFactor));
}

double _daysBetween(DateTime? from, DateTime to) => from == null ? 0 : math.max(0, (to.millisecondsSinceEpoch - from.millisecondsSinceEpoch) / _msPerDay);

int _currentStepIndex(ReviewCard card, List<double> steps) {
  final scheduledMinutes = jsRound(card.scheduledDays * 1440);
  final idx = steps.indexWhere((m) => jsRound(m) == scheduledMinutes);
  return idx < 0 ? 0 : idx;
}

class Scheduler {
  final SchedulerParams params;
  final MemoryModel model;

  const Scheduler({this.params = const SchedulerParams(), this.model = const MemoryModel()});

  double retrievabilityAt(ReviewCard card, DateTime now) {
    if (card.state == CardState.fresh || card.stability <= 0) return 0;
    return model.retrievability(_daysBetween(card.lastReviewedAt, now), card.stability);
  }

  double _graduatedInterval(MemoryState memory, String seedKey) {
    final raw = model.intervalForRetention(memory.stability, params.desiredRetention);
    final capped = math.min(params.maximumIntervalDays, math.max(1, jsRound(raw)));
    return math.min(params.maximumIntervalDays, jsRound(fuzzInterval(capped.toDouble(), params.fuzzFactor, seedKey))).toDouble();
  }

  double _stepInterval(List<double> steps, int index) => (steps.isEmpty ? 10 : steps[math.min(index, steps.length - 1)]) / 1440;

  /// Apply one review at [now]. Mirrors `createScheduler().review()` (without hint/quality adjustment: the app's
  /// review screen has no hints, so the learner's rating is applied as given).
  ReviewResult review(ReviewCard card, ReviewRating rating, DateTime now) {
    final elapsedDays = _daysBetween(card.lastReviewedAt, now);
    final seedKey = '${card.id}:${card.reps + 1}';
    late MemoryState memory;
    late CardState state;
    late double intervalDays;
    var lapses = card.lapses;
    final learning = params.learningStepsMinutes;

    if (card.state == CardState.fresh) {
      memory = model.initial(rating);
      if (rating == ReviewRating.easy || learning.isEmpty || (rating == ReviewRating.good && learning.length == 1)) {
        state = CardState.review;
        intervalDays = _graduatedInterval(memory, seedKey);
      } else {
        state = CardState.learning;
        intervalDays = _stepInterval(learning, rating == ReviewRating.good ? 1 : 0);
      }
    } else if (card.state == CardState.learning || card.state == CardState.relearning) {
      final steps = card.state == CardState.learning ? learning : params.relearningStepsMinutes;
      final idx = _currentStepIndex(card, steps);
      memory = model.next(card.memory, elapsedDays, rating);
      if (rating == ReviewRating.again) {
        state = card.state;
        intervalDays = _stepInterval(steps, 0);
      } else if (rating == ReviewRating.hard) {
        state = card.state;
        intervalDays = _stepInterval(steps, idx) * 1.5;
      } else if (rating == ReviewRating.good && idx + 1 < steps.length) {
        state = card.state;
        intervalDays = _stepInterval(steps, idx + 1);
      } else {
        state = CardState.review;
        intervalDays = _graduatedInterval(memory, seedKey);
      }
    } else {
      memory = model.next(card.memory, elapsedDays, rating);
      if (rating == ReviewRating.again) {
        lapses += 1;
        if (params.relearningStepsMinutes.isNotEmpty) {
          state = CardState.relearning;
          intervalDays = _stepInterval(params.relearningStepsMinutes, 0);
        } else {
          state = CardState.review;
          intervalDays = 1;
        }
      } else {
        state = CardState.review;
        intervalDays = _graduatedInterval(memory, seedKey);
        if (rating == ReviewRating.hard) {
          // A hard recall never grows the interval by more than 20% over the previous schedule.
          final hardCap = math.max(1, jsRound(card.scheduledDays * 1.2));
          intervalDays = math.max(1, math.min(intervalDays, hardCap.toDouble()));
        }
      }
    }

    // `new Date(ms)` in the TypeScript scheduler truncates fractional milliseconds.
    final due = DateTime.fromMillisecondsSinceEpoch(now.millisecondsSinceEpoch + (intervalDays * _msPerDay).truncate(), isUtc: true);
    return ReviewResult(
      ReviewCard(
        id: card.id,
        state: state,
        stability: memory.stability,
        difficulty: memory.difficulty,
        due: due,
        lastReviewedAt: now,
        reps: card.reps + 1,
        lapses: lapses,
        scheduledDays: intervalDays,
        elapsedDays: elapsedDays,
      ),
      intervalDays,
    );
  }
}

/// How firmly a phrase is held, from its schedule (shown on Progress; not a score of the learner's speech).
enum PhraseStrength { learning, young, solid }

PhraseStrength strengthOf(ReviewCard card) {
  if (card.state != CardState.review) return PhraseStrength.learning;
  return card.stability >= 21 ? PhraseStrength.solid : PhraseStrength.young;
}
