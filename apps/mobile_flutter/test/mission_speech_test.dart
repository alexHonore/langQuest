// Reads the content bundle from disk (dart:io): VM only.
@TestOn('vm')
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:langquest_mobile/core/backend/speech_check.dart';
import 'package:langquest_mobile/core/services/app_state.dart';
import 'package:langquest_mobile/features/learn/learn_content.dart';
import 'package:langquest_mobile/features/learn/learn_logic.dart';
import 'package:langquest_mobile/features/learn/record_take.dart';
import 'package:langquest_mobile/main.dart';
import 'package:langquest_mobile/navigation/app_router.dart';

import 'recording_fakes.dart';
import 'support.dart';

/// Pump frames for [ms] (the mission's scene animates forever, so `pumpAndSettle` would never return).
Future<void> settle(WidgetTester t, [int ms = 900]) async {
  for (var i = 0; i < ms ~/ 100; i++) {
    await t.pump(const Duration(milliseconds: 100));
  }
}

Future<void> tapText(WidgetTester t, String text) async {
  final f = find.text(text);
  expect(f, findsWidgets, reason: 'no "$text" on screen');
  await t.ensureVisible(f.first);
  await t.tap(f.first);
  await settle(t);
}

Future<void> tapLabel(WidgetTester t, String label) async {
  final f = find.bySemanticsLabel(label);
  await t.ensureVisible(f.first);
  await t.tap(f.first);
  await settle(t);
}

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);
  const missionKey = 'es_greet_and_introduce';

  testWidgets('a mission\'s spoken replies are checked by the server: the verdicts show, and rate the review', (t) async {
    t.view.physicalSize = const Size(390 * 3, 844 * 3);
    t.view.devicePixelRatio = 3;
    addTearDown(t.view.reset);
    final semantics = t.ensureSemantics();
    final mission = testBundle.mission(missionKey)!;
    final plan = buildLearnPlan(mission: mission, track: testBundle.track('spanish-spain')!, source: 'en', character: testBundle.characterOf(mission));
    // The first reply is not understood, then is; every other reply is understood at once.
    final checker = FakeChecker([
      const SpeechVerdict(SpeechVerdictKind.notUnderstood, heard: 'ola'),
      const SpeechVerdict(SpeechVerdictKind.understood, heard: 'hola'),
      for (var i = 1; i < plan.exchanges.length; i++) SpeechVerdict(SpeechVerdictKind.understood, heard: plan.exchanges[i].answer.text),
    ]);
    await t.pumpWidget(
      ProviderScope(
        overrides: [
          ...await testOverrides(),
          takeRecorderFactoryProvider.overrideWithValue(() => FakeRecorder(take: FakeTake())),
          speechCheckerProvider.overrideWithValue(checker),
        ],
        child: const LangQuestApp(),
      ),
    );
    final container = ProviderScope.containerOf(t.element(find.byType(LangQuestApp)));
    final notifier = container.read(appStateProvider.notifier)..setReduceMotion(true);
    notifier.enroll('spanish-spain', 'en');
    notifier.completeStop(missionKey, PathStop.learn);
    notifier.completeStop(missionKey, PathStop.practise);
    container.read(appRouterProvider).go('/mission/$missionKey');
    await settle(t, 1500);

    for (final (i, x) in plan.exchanges.indexed) {
      await tapText(t, x.answer.text);
      expect(find.text('Say it out loud'), findsOneWidget);
      expect(find.text('LangQuest checks what you said; the recording isn’t kept.'), findsOneWidget);
      await tapLabel(t, 'Record yourself');
      await tapLabel(t, 'Stop recording');
      if (i == 0) {
        expect(find.text('Not quite'), findsOneWidget);
        expect(find.text('I heard: “ola”'), findsOneWidget);
        await tapLabel(t, 'Record again');
        await tapLabel(t, 'Stop recording');
      }
      expect(find.text('Understood!'), findsOneWidget);
      // Every take is checked against the reply it should say, for this mission.
      final (_, target) = checker.checked.last;
      expect(target.expressionId, x.answer.id);
      expect((target.chapterKey, target.missionKey), (mission.chapterKey, mission.key));
      await tapText(t, 'I said it');
    }
    expect(checker.checked, hasLength(plan.exchanges.length + 1));
    await tapText(t, 'Complete the mission (+50 XP)');
    expect(find.text('Mission completed!'), findsOneWidget);
    // Answers are counted once each: the first checked take of each reply decides.
    final replies = {for (final x in plan.exchanges) x.answer.id}.length;
    expect(find.text('Understood out loud: ${replies - 1} of $replies'), findsOneWidget);

    final cards = container.read(appStateProvider).progress.cards;
    expect(
      cards[plan.exchanges.first.answer.id]!.difficulty,
      greaterThan(cards[plan.exchanges.last.answer.id]!.difficulty),
      reason: 'the reply not understood at first was rated hard, though chosen right the first time',
    );
    semantics.dispose();
  });
}
