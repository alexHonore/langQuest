import 'package:flutter_test/flutter_test.dart';
import 'package:langquest_mobile/core/learning/seeded_random.dart';
import 'package:langquest_mobile/core/learning/srs.dart';

// Vectors generated from the TypeScript scheduler (packages/curriculum createScheduler(), default params),
// starting from newCard() at 2026-11-10T09:00:00Z. Regenerate if the API's scheduler or params change.
const tsVectors =
    <
      String,
      List<({int atMinutes, ReviewRating rating, CardState state, double stability, double difficulty, double intervalDays, String due, int reps, int lapses})>
    >{
      'goodPath': [
        (
          atMinutes: 0,
          rating: ReviewRating.good,
          state: CardState.learning,
          stability: 3.1262,
          difficulty: 7.2102,
          intervalDays: 0.006944444444444444,
          due: '2026-11-10T09:10:00.000Z',
          reps: 1,
          lapses: 0,
        ),
        (
          atMinutes: 10,
          rating: ReviewRating.good,
          state: CardState.review,
          stability: 3.1402981133204912,
          difficulty: 7.2102,
          intervalDays: 3.0,
          due: '2026-11-13T09:10:00.000Z',
          reps: 2,
          lapses: 0,
        ),
        (
          atMinutes: 4320,
          rating: ReviewRating.good,
          state: CardState.review,
          stability: 8.634718492573734,
          difficulty: 7.2102,
          intervalDays: 9.0,
          due: '2026-11-22T09:00:00.000Z',
          reps: 3,
          lapses: 0,
        ),
        (
          atMinutes: 17280,
          rating: ReviewRating.good,
          state: CardState.review,
          stability: 22.64452401244459,
          difficulty: 7.2102,
          intervalDays: 24.0,
          due: '2026-12-16T09:00:00.000Z',
          reps: 4,
          lapses: 0,
        ),
        (
          atMinutes: 57600,
          rating: ReviewRating.easy,
          state: CardState.review,
          stability: 131.26403418366115,
          difficulty: 6.17002334,
          intervalDays: 135.0,
          due: '2027-05-04T09:00:00.000Z',
          reps: 5,
          lapses: 0,
        ),
      ],
      'easyFirst': [
        (
          atMinutes: 0,
          rating: ReviewRating.easy,
          state: CardState.review,
          stability: 15.4722,
          difficulty: 6.6786,
          intervalDays: 16.0,
          due: '2026-11-26T09:00:00.000Z',
          reps: 1,
          lapses: 0,
        ),
        (
          atMinutes: 28800,
          rating: ReviewRating.good,
          state: CardState.review,
          stability: 47.14583767840326,
          difficulty: 6.691039440000001,
          intervalDays: 48.0,
          due: '2027-01-17T09:00:00.000Z',
          reps: 2,
          lapses: 0,
        ),
        (
          atMinutes: 129600,
          rating: ReviewRating.hard,
          state: CardState.review,
          stability: 69.1496122835399,
          difficulty: 7.743364457104001,
          intervalDays: 58.0,
          due: '2027-04-07T09:00:00.000Z',
          reps: 3,
          lapses: 0,
        ),
      ],
      'lapse': [
        (
          atMinutes: 0,
          rating: ReviewRating.good,
          state: CardState.learning,
          stability: 3.1262,
          difficulty: 7.2102,
          intervalDays: 0.006944444444444444,
          due: '2026-11-10T09:10:00.000Z',
          reps: 1,
          lapses: 0,
        ),
        (
          atMinutes: 10,
          rating: ReviewRating.good,
          state: CardState.review,
          stability: 3.1402981133204912,
          difficulty: 7.2102,
          intervalDays: 3.0,
          due: '2026-11-13T09:10:00.000Z',
          reps: 2,
          lapses: 0,
        ),
        (
          atMinutes: 4320,
          rating: ReviewRating.again,
          state: CardState.relearning,
          stability: 1.0667759442697056,
          difficulty: 9.29055332,
          intervalDays: 0.006944444444444444,
          due: '2026-11-13T09:10:00.000Z',
          reps: 3,
          lapses: 1,
        ),
        (
          atMinutes: 4330,
          rating: ReviewRating.good,
          state: CardState.review,
          stability: 1.0742798445198858,
          difficulty: 9.241873052312,
          intervalDays: 1.0,
          due: '2026-11-14T09:10:00.000Z',
          reps: 4,
          lapses: 1,
        ),
        (
          atMinutes: 7200,
          rating: ReviewRating.good,
          state: CardState.review,
          stability: 2.915839681497228,
          difficulty: 9.1943319028879,
          intervalDays: 3.0,
          due: '2026-11-18T09:00:00.000Z',
          reps: 5,
          lapses: 1,
        ),
      ],
      'hardStart': [
        (
          atMinutes: 0,
          rating: ReviewRating.hard,
          state: CardState.learning,
          stability: 1.1829,
          difficulty: 7.7418000000000005,
          intervalDays: 0.0006944444444444445,
          due: '2026-11-10T09:01:00.000Z',
          reps: 1,
          lapses: 0,
        ),
        (
          atMinutes: 2,
          rating: ReviewRating.hard,
          state: CardState.learning,
          stability: 1.1835780271323288,
          difficulty: 8.76953722,
          intervalDays: 0.0010416666666666667,
          due: '2026-11-10T09:03:30.000Z',
          reps: 2,
          lapses: 0,
        ),
        (
          atMinutes: 5,
          rating: ReviewRating.good,
          state: CardState.learning,
          stability: 1.1864701213925752,
          difficulty: 8.733048729052,
          intervalDays: 0.006944444444444444,
          due: '2026-11-10T09:15:00.000Z',
          reps: 3,
          lapses: 0,
        ),
        (
          atMinutes: 20,
          rating: ReviewRating.good,
          state: CardState.review,
          stability: 1.201150033887467,
          difficulty: 8.697414068792183,
          intervalDays: 1.0,
          due: '2026-11-11T09:20:00.000Z',
          reps: 4,
          lapses: 0,
        ),
      ],
      'againStart': [
        (
          atMinutes: 0,
          rating: ReviewRating.again,
          state: CardState.learning,
          stability: 0.4072,
          difficulty: 8.2734,
          intervalDays: 0.0006944444444444445,
          due: '2026-11-10T09:01:00.000Z',
          reps: 1,
          lapses: 0,
        ),
        (
          atMinutes: 1,
          rating: ReviewRating.again,
          state: CardState.learning,
          stability: 0.17335981540132084,
          difficulty: 10,
          intervalDays: 0.0006944444444444445,
          due: '2026-11-10T09:02:00.000Z',
          reps: 2,
          lapses: 0,
        ),
        (
          atMinutes: 3,
          rating: ReviewRating.good,
          state: CardState.learning,
          stability: 0.17452187683523634,
          difficulty: 9.93471868,
          intervalDays: 0.006944444444444444,
          due: '2026-11-10T09:13:00.000Z',
          reps: 3,
          lapses: 0,
        ),
        (
          atMinutes: 14,
          rating: ReviewRating.good,
          state: CardState.review,
          stability: 0.18129624017313586,
          difficulty: 9.870964942888,
          intervalDays: 1.0,
          due: '2026-11-11T09:14:00.000Z',
          reps: 4,
          lapses: 0,
        ),
        (
          atMinutes: 2880,
          rating: ReviewRating.hard,
          state: CardState.review,
          stability: 0.396002786819971,
          difficulty: 10,
          intervalDays: 1.0,
          due: '2026-11-13T09:00:00.000Z',
          reps: 5,
          lapses: 0,
        ),
      ],
    };
const tsFnv = <(String, int)>[("", 2166136261), ("a", 3826002220), ("card-x:1", 3772608115), ("ary_ch1:ary_cafe:bghit", 2381089562)];
const tsSeeded = <double>[0.5159669674467295, 0.7994903530925512, 0.9151450197678059];
const tsFuzz = <(double, String, double)>[
  (10.0, "card-x:1", 10.01596696744673),
  (3.0, "k:2", 3.0837780842324722),
  (2.0, "k:2", 2.0),
  (100.0, "abc:7", 104.62149523198605),
];
const tsRetrievability = <(double, double, double)>[
  (1.0, 2.3, 0.9526030172764052),
  (10.0, 2.3, 0.7036218514273174),
  (0.0, 5.0, 1.0),
  (30.0, 50.0, 0.9362816758985388),
];

void main() {
  final t0 = DateTime.utc(2026, 11, 10, 9);

  group('seeded random matches packages/curriculum/src/planner/random.ts', () {
    test('fnv1a32', () {
      for (final (input, expected) in tsFnv) {
        expect(fnv1a32(input), expected, reason: input);
      }
    });

    test('mulberry32 sequence', () {
      final s = Seeded('card-x:1');
      for (final expected in tsSeeded) {
        expect(s.next(), closeTo(expected, 1e-15));
      }
    });

    test('imul32 keeps the low 32 bits of large products', () {
      expect(imul32(0xFFFFFFFF, 0xFFFFFFFF), 1);
      // A plain `(a * b) & 0xFFFFFFFF` gives 84696352 when compiled to JavaScript (the product exceeds 2^53).
      expect(imul32(0x811c9dc5, 0x01000193), 84696351);
    });
  });

  group('scheduler matches the TypeScript createScheduler()', () {
    test('interval fuzz', () {
      for (final (days, key, expected) in tsFuzz) {
        expect(fuzzInterval(days, 0.05, key), closeTo(expected, 1e-9), reason: '$days $key');
      }
    });

    test('retrievability', () {
      for (final (elapsed, stability, expected) in tsRetrievability) {
        expect(const MemoryModel().retrievability(elapsed, stability), closeTo(expected, 1e-12));
      }
    });

    for (final entry in tsVectors.entries) {
      test('review sequence ${entry.key}', () {
        const scheduler = Scheduler();
        var card = ReviewCard.fresh('card-${entry.key}', t0);
        for (final step in entry.value) {
          final now = t0.add(Duration(minutes: step.atMinutes));
          final result = scheduler.review(card, step.rating, now);
          card = result.card;
          final at = '${entry.key} @${step.atMinutes}min';
          expect(card.state, step.state, reason: at);
          expect(card.stability, closeTo(step.stability, 1e-9), reason: at);
          expect(card.difficulty, closeTo(step.difficulty, 1e-9), reason: at);
          expect(result.intervalDays, closeTo(step.intervalDays, 1e-12), reason: at);
          expect(card.due.toUtc().toIso8601String(), step.due.replaceFirst('.000Z', '.000Z'), reason: at);
          expect(card.reps, step.reps, reason: at);
          expect(card.lapses, step.lapses, reason: at);
        }
      });
    }
  });

  group('review cards', () {
    test('a fresh card is due immediately and round-trips through JSON', () {
      final card = ReviewCard.fresh('a:b:c', t0);
      expect(card.isDue(t0), isTrue);
      final copy = ReviewCard.fromJson(card.toJson())!;
      expect(copy.state, CardState.fresh);
      expect(copy.due, card.due);

      final reviewed = const Scheduler().review(card, ReviewRating.good, t0).card;
      final again = ReviewCard.fromJson(reviewed.toJson())!;
      expect(again.state, CardState.learning);
      expect(again.lastReviewedAt, t0);
      expect(again.isDue(t0.add(const Duration(minutes: 9))), isFalse);
      expect(again.isDue(t0.add(const Duration(minutes: 10))), isTrue);
    });

    test('unreadable stored cards are dropped, not thrown', () {
      expect(ReviewCard.fromJson(null), isNull);
      expect(ReviewCard.fromJson({'id': 'x', 'state': 'bogus', 'due': '2026-01-01T00:00:00Z'}), isNull);
      expect(ReviewCard.fromJson({'id': 'x', 'state': 'review', 'due': 'not a date'}), isNull);
    });

    test('strength buckets follow the schedule, not a speech score', () {
      final fresh = ReviewCard.fresh('x', t0);
      expect(strengthOf(fresh), PhraseStrength.learning);
      var card = const Scheduler().review(fresh, ReviewRating.easy, t0).card;
      expect(strengthOf(card), PhraseStrength.young);
      card = const Scheduler().review(card, ReviewRating.easy, t0.add(const Duration(days: 16))).card;
      expect(card.stability, greaterThanOrEqualTo(21));
      expect(strengthOf(card), PhraseStrength.solid);
    });
  });
}
