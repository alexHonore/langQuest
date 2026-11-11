// Reads the content bundle and the bundled clips from disk (dart:io): VM only.
@TestOn('vm')
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:langquest_mobile/core/audio/clip_player_provider.dart';
import 'package:langquest_mobile/core/backend/server_voice.dart';
import 'package:langquest_mobile/core/backend/speech_check.dart';
import 'package:langquest_mobile/core/services/app_state.dart';
import 'package:langquest_mobile/features/call/call_screen.dart';
import 'package:langquest_mobile/features/learn/record_take.dart';
import 'package:langquest_mobile/main.dart';
import 'package:langquest_mobile/navigation/app_router.dart';

import 'call_fakes.dart';
import 'recording_fakes.dart';
import 'support.dart';

Future<void> settle(WidgetTester t, [int ms = 900]) async {
  for (var i = 0; i < ms ~/ 100; i++) {
    await t.pump(const Duration(milliseconds: 100));
  }
}

Future<void> tapLabel(WidgetTester t, String label) async {
  final f = find.bySemanticsLabel(label);
  await t.ensureVisible(f.first);
  await t.tap(f.first);
  await settle(t);
}

FilledButton saidIt(WidgetTester t) => t.widget<FilledButton>(find.ancestor(of: find.text('I said it'), matching: find.byType(FilledButton)));

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);
  const missionKey = 'es_greet_and_introduce';

  group('the bundled AI voices', () {
    final voices = testBundle.voices;

    test('almost every line is read by a natural AI voice bundled with the app, each clip present', () {
      final lines = [
        for (final c in testBundle.chapters)
          for (final m in c.missions) ...m.expressions,
      ];
      expect(voices.clips.length, greaterThanOrEqualTo(lines.length - 3), reason: 'a line no take passed the listening check may stay unvoiced');
      for (final file in voices.clips.values) {
        expect(File(file).existsSync(), isTrue, reason: '$file is missing');
      }
    });

    test('the two sides of a conversation sound different: the character and the learner never share a voice', () {
      for (final c in testBundle.chapters) {
        final learnerVoices = <String>{};
        for (final m in c.missions) {
          final learner = {for (final e in m.expressions.where((e) => e.byLearner)) ?voices.voiceOf[e.id]};
          final character = {for (final e in m.expressions.where((e) => !e.byLearner)) ?voices.voiceOf[e.id]};
          expect(learner.intersection(character), isEmpty, reason: '${m.key}: same voice on both sides');
          expect(character.length, lessThanOrEqualTo(1), reason: '${m.key}: one character, one voice');
          learnerVoices.addAll(learner);
        }
        expect(learnerVoices, hasLength(1), reason: '${c.courseTrackId}: the learner keeps one voice through the course');
      }
    });

    test('a line plays its bundled clip, signed out and offline; "Slowly" is the same clip played slower', () async {
      final player = FakeClipPlayer(instant: true);
      final container = ProviderContainer(overrides: [...await testOverrides(), clipPlayerFactoryProvider.overrideWithValue(() => player)]);
      addTearDown(container.dispose);
      container.read(appStateProvider.notifier).enroll('spanish-spain', 'en');
      final line = testBundle.mission(missionKey)!.expressions.first;
      final voice = await container.read(lineVoiceProvider('es-ES').future);
      expect(voice.aiFor(line.id), isTrue);
      await voice.say(text: line.text, expressionId: line.id);
      await voice.say(text: line.text, expressionId: line.id, slow: true);
      expect(player.played, ['assets/${voices.clipOf(line.id)}', 'assets/${voices.clipOf(line.id)}']);
      expect(player.rates, [1, slowPlaybackRate]);
      expect(slowPlaybackRate, lessThan(0.8));
    });
  });

  group('speaking steps', () {
    Future<ProviderContainer> openScene(WidgetTester t, {SpeechChecker? checker}) async {
      t.view.physicalSize = const Size(390 * 3, 844 * 3);
      t.view.devicePixelRatio = 3;
      addTearDown(t.view.reset);
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
      container.read(appStateProvider.notifier)
        ..setReduceMotion(true)
        ..setReadAloud(false)
        ..enroll('spanish-spain', 'en');
      container.read(appRouterProvider).go('/learn/$missionKey/scene');
      await settle(t, 1200);
      // Through the character's lines to the learner's first one.
      while (find.text('I said it').evaluate().isEmpty) {
        await t.tap(find.text('Next').first);
        await settle(t);
      }
      return container;
    }

    testWidgets('the learner\'s line waits for a take before "I said it" (no skipping)', (t) async {
      final semantics = t.ensureSemantics();
      await openScene(t);
      expect(saidIt(t).onPressed, isNull);
      expect(find.text('Say it out loud to continue'), findsOneWidget);
      await tapLabel(t, 'Record yourself');
      await tapLabel(t, 'Stop recording');
      expect(saidIt(t).onPressed, isNotNull, reason: 'nothing can check it signed out: a real take is enough');
      semantics.dispose();
    });

    testWidgets('checked: a take not understood asks again; after three tries the learner may move on', (t) async {
      final semantics = t.ensureSemantics();
      await openScene(t, checker: FakeChecker([for (var i = 0; i < 3; i++) const SpeechVerdict(SpeechVerdictKind.notUnderstood, heard: 'eh')]));
      await tapLabel(t, 'Record yourself');
      await tapLabel(t, 'Stop recording');
      expect(saidIt(t).onPressed, isNull);
      expect(find.text('Not quite yet: try again (1 of 3)'), findsOneWidget);
      for (var i = 0; i < 2; i++) {
        await tapLabel(t, 'Record again');
        await tapLabel(t, 'Stop recording');
      }
      expect(saidIt(t).onPressed, isNotNull);
      semantics.dispose();
    });

    testWidgets('"Can\'t speak now" lets the learner continue without speaking, for a while', (t) async {
      final semantics = t.ensureSemantics();
      final container = await openScene(t);
      await t.tap(find.text('Can’t speak now'));
      await settle(t);
      expect(saidIt(t).onPressed, isNotNull);
      expect(container.read(speakingPauseProvider.notifier).active, isTrue);
      semantics.dispose();
    });
  });

  testWidgets('signed out on a course with calls: the Speak tab shows the course\'s people and how to call them', (t) async {
    t.view.physicalSize = const Size(390 * 3, 844 * 3);
    t.view.devicePixelRatio = 3;
    addTearDown(t.view.reset);
    await t.pumpWidget(ProviderScope(overrides: [...await testOverrides(), callsNeedAccountProvider.overrideWithValue(true)], child: const LangQuestApp()));
    final container = ProviderScope.containerOf(t.element(find.byType(LangQuestApp)));
    container.read(appStateProvider.notifier)
      ..setReduceMotion(true)
      ..enroll('spanish-spain', 'en');
    container.read(appRouterProvider).go('/');
    await settle(t);
    expect(find.text('Speak'), findsWidgets, reason: 'the tab is there signed out');
    container.read(appRouterProvider).go('/talk');
    await settle(t);
    expect(find.text('Create a free account to call'), findsOneWidget);
    expect(find.text('Lucía'), findsOneWidget);
  });
}
