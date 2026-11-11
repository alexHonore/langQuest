// Reads the content bundle from disk (dart:io): VM only.
@TestOn('vm')
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:langquest_mobile/core/audio/take_recorder.dart';
import 'package:langquest_mobile/core/services/app_state.dart';
import 'package:langquest_mobile/features/learn/learn_content.dart';
import 'package:langquest_mobile/features/learn/learn_logic.dart';
import 'package:langquest_mobile/features/learn/record_take.dart';
import 'package:langquest_mobile/main.dart';
import 'package:langquest_mobile/navigation/app_router.dart';

import 'support.dart';

/// A recorder that is never started in these tests: its presence is what makes recording "available".
class IdleRecorder implements TakeRecorder {
  @override
  Future<void> start() async {}
  @override
  Stream<double> get levels => const Stream.empty();
  @override
  Future<RecordedTake?> stop() async => null;
  @override
  Future<void> dispose() async {}
}

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);
  const missionKey = 'es_greet_and_introduce';

  Future<ProviderContainer> pumpPath(WidgetTester t, {required bool canRecord, required bool learnDone}) async {
    t.view.physicalSize = const Size(390 * 3, 844 * 3);
    t.view.devicePixelRatio = 3;
    addTearDown(t.view.reset);
    await t.pumpWidget(
      ProviderScope(
        overrides: [...await testOverrides(), takeRecorderFactoryProvider.overrideWithValue(canRecord ? IdleRecorder.new : null)],
        child: const LangQuestApp(),
      ),
    );
    final container = ProviderScope.containerOf(t.element(find.byType(LangQuestApp)));
    final notifier = container.read(appStateProvider.notifier)..setReduceMotion(true);
    notifier.enroll('spanish-spain', 'en');
    if (learnDone) notifier.completeStop(missionKey, PathStop.learn);
    container.read(appRouterProvider).go('/path/$missionKey');
    await t.pumpAndSettle();
    return container;
  }

  testWidgets('the path offers to practise saying the phrases once they are taught, where the device can record', (t) async {
    await pumpPath(t, canRecord: true, learnDone: false);
    expect(find.text('Practise saying the phrases'), findsNothing, reason: 'nothing taught yet');
    await t.pumpWidget(const SizedBox());

    await pumpPath(t, canRecord: false, learnDone: true);
    expect(find.text('Practise saying the phrases'), findsNothing, reason: 'no recorder (visible means usable)');
    await t.pumpWidget(const SizedBox());

    await pumpPath(t, canRecord: true, learnDone: true);
    expect(find.text('Practise saying the phrases'), findsOneWidget);
  });

  testWidgets('practise saying walks the mission’s phrases with listen / record / compare, and no score', (t) async {
    await pumpPath(t, canRecord: true, learnDone: true);
    final mission = testBundle.mission(missionKey)!;
    final plan = buildLearnPlan(mission: mission, track: testBundle.track('spanish-spain')!, source: 'en', character: testBundle.characterOf(mission));

    await t.tap(find.text('Practise saying the phrases'));
    await t.pumpAndSettle();
    expect(find.text(plan.phrases.first.text), findsOneWidget);
    expect(find.text('Record yourself'), findsOneWidget);
    expect(find.textContaining('There is no score'), findsOneWidget);
    expect(find.textContaining('%'), findsNothing);

    for (var i = 1; i < plan.phrases.length; i++) {
      await t.tap(find.text('Next phrase'));
      await t.pumpAndSettle();
      expect(find.text(plan.phrases[i].text), findsOneWidget);
    }
    await t.tap(find.byTooltip('Previous phrase'));
    await t.pumpAndSettle();
    expect(find.text(plan.phrases[plan.phrases.length - 2].text), findsOneWidget);
    await t.tap(find.text('Next phrase'));
    await t.pumpAndSettle();

    await t.tap(find.text('Done'));
    await t.pumpAndSettle();
    expect(find.text('Practise saying the phrases'), findsOneWidget, reason: 'back on the mission path');
  });
}
