// Reads the content bundle from disk (dart:io): VM only. Pure logic shared with web is covered by srs_test.dart.
@TestOn('vm')
library;

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:langquest_mobile/core/learning/srs.dart';
import 'package:langquest_mobile/core/services/app_state.dart';
import 'package:langquest_mobile/core/services/learner_state.dart';
import 'package:langquest_mobile/core/services/learner_store.dart';
import 'package:langquest_mobile/features/learn/learn_logic.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support.dart';

void main() {
  group('learner state', () {
    test('round-trips through JSON', () {
      final state = const LearnerState(uiLanguage: 'fr', darkMode: false, activeCourseId: 'arabic-moroccan|fr')
          .copyWith(
            enrollments: [Enrollment(trackId: 'arabic-moroccan', source: 'fr', enrolledAt: DateTime.utc(2026, 11, 1))],
          )
          .withCourse(
            'arabic-moroccan|fr',
            const CourseProgress().withStop('ary_greet_and_introduce', PathStop.learn).withCards({
              'x:y:z': ReviewCard.fresh('x:y:z', DateTime.utc(2026, 11, 10)),
            }),
          )
          .withXp(5, testNow);
      final copy = LearnerState.fromJson(jsonDecode(jsonEncode(state.toJson())));
      expect(copy.uiLanguage, 'fr');
      expect(copy.darkMode, isFalse);
      expect(copy.activeEnrollment?.courseId, 'arabic-moroccan|fr');
      expect(copy.progressOf('arabic-moroccan|fr').stopsDone('ary_greet_and_introduce'), {PathStop.learn});
      expect(copy.progressOf('arabic-moroccan|fr').cards.keys, ['x:y:z']);
      expect(copy.xpTotal, 5);
      expect(copy.xpByDay, {dayKey(testNow): 5});
    });

    test('damaged or foreign saved data falls back to defaults instead of crashing', () {
      expect(LearnerState.fromJson(null).enrollments, isEmpty);
      expect(LearnerState.fromJson({'v': 99}).enrollments, isEmpty);
      final partial = LearnerState.fromJson({
        'v': 1,
        'enrollments': [
          {'trackId': 'japanese', 'source': 'en'},
          'garbage',
          {'trackId': 3},
        ],
        'courses': {
          'japanese|en': {
            'stops': {
              'm': ['learn', 'bogus'],
            },
            'cards': {'a': 'nope'},
          },
        },
        'xpByDay': {'2026-11-10': 'x', '2026-11-09': 3},
      });
      expect(partial.enrollments.single.trackId, 'japanese');
      expect(partial.progressOf('japanese|en').stopsDone('m'), {PathStop.learn});
      expect(partial.progressOf('japanese|en').cards, isEmpty);
      expect(partial.xpByDay, {'2026-11-09': 3});
      expect(partial.darkMode, isTrue);
    });

    test('streak counts consecutive active days ending today or yesterday', () {
      final today = DateTime(2026, 11, 10, 20);
      String d(int back) => dayKey(today.subtract(Duration(days: back)));
      expect(streakDays({}, today), 0);
      expect(streakDays({d(0): 5}, today), 1);
      expect(streakDays({d(0): 5, d(1): 3, d(2): 50}, today), 3);
      expect(streakDays({d(1): 3, d(2): 50}, today), 2, reason: 'today not practised yet: the streak is kept');
      expect(streakDays({d(2): 50}, today), 0, reason: 'a missed day pauses it');
      expect(streakDays({d(0): 5, d(2): 50}, today), 1);
    });
  });

  group('app state', () {
    test('a fresh learner has no course; the interface follows a supported device language', () async {
      final fr = await testContainer(device: 'fr');
      addTearDown(fr.dispose);
      expect(fr.read(appStateProvider).hasEnrollment, isFalse);
      expect(fr.read(appStateProvider).uiLanguage, 'fr');
      final de = await testContainer(device: 'de');
      addTearDown(de.dispose);
      expect(de.read(appStateProvider).uiLanguage, 'en');
    });

    test('enrollment only where content exists; the new course becomes active', () async {
      final c = await testContainer();
      addTearDown(c.dispose);
      final n = c.read(appStateProvider.notifier);
      expect(n.enroll('french', 'fr'), isFalse, reason: 'French is taught from English only');
      expect(n.enroll('english', 'en'), isFalse, reason: 'English is taught from French and Russian only');
      expect(n.enroll('arabic-moroccan', 'fr'), isTrue);
      expect(n.enroll('japanese', 'en'), isTrue);
      final s = c.read(appStateProvider);
      expect(s.learner.enrollments.map((e) => e.courseId), ['arabic-moroccan|fr', 'japanese|en']);
      expect(s.activeCourse?.id, 'japanese|en');
      expect(s.accent.trackId, 'japanese');
      n.switchCourse('arabic-moroccan|fr');
      expect(c.read(appStateProvider).activeCourse?.track.id, 'arabic-moroccan');
    });

    test('missions unlock in order; the next mission follows completion', () async {
      final c = await testContainer();
      addTearDown(c.dispose);
      final n = c.read(appStateProvider.notifier)..enroll('spanish-spain', 'en');
      var s = c.read(appStateProvider);
      final course = s.activeCourse!;
      final m = course.missions;
      expect(s.isUnlocked(course, m[0].key), isTrue);
      expect(s.isUnlocked(course, m[1].key), isFalse);
      expect(s.nextMission(course)?.key, m[0].key);

      n.completeMission(m[0].key, const {});
      s = c.read(appStateProvider);
      expect(s.isUnlocked(course, m[1].key), isTrue);
      expect(s.isUnlocked(course, m[2].key), isFalse);
      expect(s.nextMission(course)?.key, m[1].key);

      for (final mission in m) {
        n.completeMission(mission.key, const {});
      }
      expect(c.read(appStateProvider).nextMission(course), isNull);
    });

    test('XP: steps and missions pay once, reviews pay each time; all of it counts today', () async {
      final clock = TestClock();
      final c = await testContainer(clock: clock);
      addTearDown(c.dispose);
      final n = c.read(appStateProvider.notifier)..enroll('arabic-moroccan', 'fr');
      const key = 'ary_cafe_order_drink';
      n.completeStop(key, PathStop.learn);
      n.completeStop(key, PathStop.learn);
      n.completeStop(key, PathStop.practise);
      expect(c.read(appStateProvider).learner.xpTotal, 2 * XpAmounts.stepCompleted);

      const exprId = 'ary_ch1_arrival_casablanca:ary_cafe_order_drink:bghit_qahwa';
      n.completeMission(key, {exprId: ReviewRating.good});
      n.completeMission(key, {exprId: ReviewRating.good});
      var s = c.read(appStateProvider);
      expect(s.learner.xpTotal, 2 * XpAmounts.stepCompleted + XpAmounts.missionCompleted);
      expect(s.progress.cards.keys, [exprId]);
      expect(s.progress.cards[exprId]!.state, CardState.learning);
      expect(s.dueCards(clock.now), isEmpty, reason: 'next step is 10 minutes away');

      clock.advance(const Duration(minutes: 10));
      expect(c.read(appStateProvider).dueCards(clock.now).single.id, exprId);
      n.reviewCard(exprId, ReviewRating.good);
      s = c.read(appStateProvider);
      expect(s.learner.xpTotal, 2 * XpAmounts.stepCompleted + XpAmounts.missionCompleted + XpAmounts.reviewCompleted);
      expect(s.progress.cards[exprId]!.state, CardState.review);
      expect(s.dueCards(clock.now), isEmpty);
      expect(s.streak(clock.now), 1);
      expect(s.learner.xpByDay[dayKey(clock.now)], s.learner.xpTotal);
    });

    test('a stop of a mission outside the active course is ignored', () async {
      final c = await testContainer();
      addTearDown(c.dispose);
      final n = c.read(appStateProvider.notifier)..enroll('japanese', 'en');
      n.completeStop('ary_cafe_order_drink', PathStop.learn);
      n.completeMission('ary_cafe_order_drink', const {});
      expect(c.read(appStateProvider).learner.xpTotal, 0);
    });

    test('progress is saved and restored; removing a course keeps the others', () async {
      final c = await testContainer();
      final n = c.read(appStateProvider.notifier)
        ..enroll('arabic-moroccan', 'en')
        ..enroll('english', 'fr')
        ..setUiLanguage('fr')
        ..setDarkMode(false)
        ..completeStop('en_greet_and_introduce', PathStop.learn);
      final raw = (await SharedPreferences.getInstance()).getString(LearnerStore.key);
      c.dispose();
      expect(raw, isNotNull);

      final restored = await testContainer(prefs: {LearnerStore.key: raw!});
      addTearDown(restored.dispose);
      var s = restored.read(appStateProvider);
      expect(s.uiLanguage, 'fr');
      expect(s.isDark, isFalse);
      expect(s.activeCourse?.id, 'english|fr');
      expect(s.stopsDone('en_greet_and_introduce'), {PathStop.learn});

      restored.read(appStateProvider.notifier).unenroll('english|fr');
      s = restored.read(appStateProvider);
      expect(s.learner.enrollments.map((e) => e.courseId), ['arabic-moroccan|en']);
      expect(s.activeCourse?.id, 'arabic-moroccan|en');
      expect(s.learner.courses.containsKey('english|fr'), isFalse);
      expect(n, isNotNull);
    });

    test('an unreadable saved entry starts fresh instead of locking the learner out', () async {
      final c = await testContainer(prefs: {LearnerStore.key: '{not json'});
      addTearDown(c.dispose);
      expect(c.read(appStateProvider).hasEnrollment, isFalse);
    });

    test('reset forgets courses and XP but keeps language and theme', () async {
      final c = await testContainer();
      addTearDown(c.dispose);
      final n = c.read(appStateProvider.notifier)
        ..setUiLanguage('fr')
        ..enroll('arabic-moroccan', 'fr')
        ..completeStop('ary_greet_and_introduce', PathStop.learn)
        ..resetAll();
      final s = c.read(appStateProvider);
      expect(s.hasEnrollment, isFalse);
      expect(s.learner.xpTotal, 0);
      expect(s.uiLanguage, 'fr');
      expect(n, isNotNull);
    });
  });
}
