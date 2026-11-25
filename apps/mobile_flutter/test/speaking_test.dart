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

    test('every course reads (almost) every line of chapter 1 with a natural AI voice bundled with the app; every clip is present', () {
      const firstCourses = {'arabic-moroccan', 'spanish-spain', 'japanese', 'english'};
      // Chapter 2's clips are made by a later run of `synthesize-bundle-audio`; until then its lines are said by the
      // server's voice or the device's, and its audio lessons are offered only where one of them can say every line.
      for (final c in testBundle.chapters.where((c) => c.chapterIndex == 1)) {
        final lines = [for (final m in c.missions) ...m.expressions];
        final voiced = lines.where((e) => voices.clips.containsKey(e.id)).length;
        // A line no take passed the listening check for stays unvoiced (the next voice of the chain says it).
        if (firstCourses.contains(c.courseTrackId)) {
          expect(voiced, greaterThanOrEqualTo(lines.length - 3), reason: c.courseTrackId);
        } else {
          expect(voiced, greaterThanOrEqualTo((lines.length * 0.85).ceil()), reason: '${c.courseTrackId}: $voiced of ${lines.length} voiced');
        }
      }
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
        expect(learnerVoices.length, lessThanOrEqualTo(1), reason: '${c.courseTrackId}: the learner keeps one voice through the course');
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
      // Played from the content location (here the repository's layout; in the app, the content bucket).
      expect(player.played, [voices.clipOf(line.id), voices.clipOf(line.id)]);
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
      while (find.text('Continue without recording').evaluate().isEmpty) {
        await t.tap(find.text('Next').first);
        await settle(t);
      }
      return container;
    }

    testWidgets('a learner can record at the speaking step', (t) async {
      final semantics = t.ensureSemantics();
      await openScene(t);
      expect(find.text('I said it'), findsNothing);
      expect(find.text('Continue without recording'), findsOneWidget);
      await tapLabel(t, 'Record yourself');
      await tapLabel(t, 'Stop recording');
      expect(saidIt(t).onPressed, isNotNull, reason: 'nothing can check it signed out: a real take is enough');
      semantics.dispose();
    });

    testWidgets('a checked take unlocks continue and can be redone in place', (t) async {
      final semantics = t.ensureSemantics();
      await openScene(t, checker: FakeChecker([for (var i = 0; i < 3; i++) const SpeechVerdict(SpeechVerdictKind.notUnderstood, heard: 'eh')]));
      await tapLabel(t, 'Record yourself');
      await tapLabel(t, 'Stop recording');
      expect(saidIt(t).onPressed, isNotNull);
      expect(find.text('Not quite'), findsOneWidget);
      for (var i = 0; i < 2; i++) {
        await tapLabel(t, 'Record again');
        await tapLabel(t, 'Stop recording');
      }
      expect(saidIt(t).onPressed, isNotNull);
      semantics.dispose();
    });

    testWidgets('continuing without recording saves the choice through the mission', (t) async {
      final semantics = t.ensureSemantics();
      final container = await openScene(t);
      await tapLabel(t, 'Continue without recording');
      expect(container.read(appStateProvider).progress.quietMissions, contains(missionKey));
      expect(find.text('I said it'), findsNothing);
      expect(find.text('Next'), findsOneWidget);
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
