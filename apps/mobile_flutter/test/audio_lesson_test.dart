// Reads the content bundle from disk (dart:io): VM only.
@TestOn('vm')
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:langquest_mobile/core/backend/server_voice.dart';
import 'package:langquest_mobile/core/services/app_state.dart';
import 'package:langquest_mobile/core/services/speech_service.dart';
import 'package:langquest_mobile/features/audio/audio_lesson.dart';
import 'package:langquest_mobile/features/audio/audio_lesson_player.dart';
import 'package:langquest_mobile/features/audio/audio_screens.dart';
import 'package:langquest_mobile/features/learn/learn_content.dart';
import 'package:langquest_mobile/main.dart';
import 'package:langquest_mobile/navigation/app_router.dart';

import 'support.dart';

/// A device with voices for Spain Spanish and English; what is said is recorded, and each utterance ends at once.
class SpeakingDevice extends SpeechService {
  final said = <(String text, String locale, bool slow)>[];
  var stops = 0;

  @override
  Future<bool> supports(String? locale) async => locale == 'es-ES';

  @override
  Future<String?> voiceForLanguage(String language) async => language == 'en' ? 'en-US' : null;

  @override
  Future<void> speak(String text, {required String locale, bool slow = false}) async => said.add((text, locale, slow));

  @override
  Future<void> stop() async => stops++;
}

const narration = AudioNarration(intro: _intro, phrasesIntro: 'Phrase by phrase.', againIntro: 'Once more.', outro: 'The end.');
String _intro(String mission) => 'Intro: $mission';

MissionLearnPlan planOf(String key) {
  final mission = testBundle.mission(key)!;
  return buildLearnPlan(mission: mission, track: testBundle.track('spanish-spain')!, source: 'en', character: testBundle.characterOf(mission));
}

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  test('a lesson is the mission\'s conversation, its phrases with time to repeat, and the conversation again', () {
    final plan = planOf('es_greet_and_introduce');
    final lesson = buildAudioLesson(plan, narration);
    final steps = lesson.steps;
    expect(steps.first.text, 'Intro: ${plan.mission.titleIn('en')}');
    final said = [for (final s in steps.where((s) => s.kind == AudioStepKind.say)) (s.section, s.expression!.id, s.slow)];
    final lines = [for (final l in plan.sceneLines) l.expression.id];
    expect([for (final s in said.where((s) => s.$1 == AudioSection.conversation)) s.$2], lines);
    expect([for (final s in said.where((s) => s.$1 == AudioSection.conversationAgain)) s.$2], lines);
    // Each phrase: slowly, then the learner's turn, then at normal speed.
    final drill = [
      for (final s in steps.where((s) => s.section == AudioSection.phraseByPhrase && s.kind != AudioStepKind.pause)) (s.kind, s.expression?.id, s.slow),
    ];
    final expected = [
      (AudioStepKind.narrate, null, false),
      for (final p in plan.phrases) ...[
        (AudioStepKind.narrate, null, false),
        (AudioStepKind.say, p.id, true),
        (AudioStepKind.yourTurn, p.id, false),
        (AudioStepKind.say, p.id, false),
      ],
    ];
    expect(drill, expected);
    // The meaning is narrated before each phrase, never anything the mission does not teach.
    expect(steps.where((s) => s.kind == AudioStepKind.narrate).map((s) => s.text), containsAll([for (final p in plan.phrases) plan.shortMeaningOf(p)]));
    expect(steps.last.text, 'The end.');
    expect(lesson.phraseCount, plan.phrases.length);
    expect(lesson.estimatedLength, greaterThan(const Duration(minutes: 1)));
    expect(lesson.startOf(AudioSection.phraseByPhrase), greaterThan(lesson.startOf(AudioSection.conversation)));
  });

  testWidgets('the player says each step in order; pause stops at once; next, previous and slowly work', (t) async {
    final device = SpeakingDevice();
    final plan = planOf('es_greet_and_introduce');
    final lesson = buildAudioLesson(plan, narration);
    var finished = 0;
    final player = AudioLessonPlayer(
      lesson: lesson,
      voice: LineVoice(source: LineVoiceSource.device, locale: 'es-ES', speech: device),
      narrate: (text) => device.speak(text, locale: 'en-US'),
      onFinished: () => finished++,
    );
    addTearDown(player.dispose);

    // Play to the end with the turns off: every line and narration, in order, nothing else.
    player.setTurns(false);
    final play = player.play();
    await t.pump(const Duration(minutes: 5));
    await play;
    expect(player.finished, isTrue);
    expect(finished, 1);
    final expected = [
      for (final s in lesson.steps)
        if (s.kind == AudioStepKind.narrate) (s.text, 'en-US', false) else if (s.kind == AudioStepKind.say) (s.expression!.text, 'es-ES', s.slow),
    ];
    expect(device.said, expected);

    // Again, slowly: every line is slow; pause stops the voice and the lesson where it is.
    device.said.clear();
    player.setSlow(true);
    final again = player.play();
    expect(player.index, 0, reason: 'a finished lesson starts over');
    await t.pump(const Duration(seconds: 3));
    player.pause();
    final at = player.index;
    expect(player.playing, isFalse);
    expect(device.stops, greaterThan(0));
    await t.pump(const Duration(seconds: 10));
    await again;
    expect(player.index, at, reason: 'nothing moves while paused');
    expect(device.said.where((s) => s.$2 == 'es-ES').every((s) => s.$3), isTrue);

    // Next and previous move between lines.
    final lines = player.lineIndexes.toList();
    player.seek(lines[2]);
    player.next();
    expect(player.index, lines[3]);
    player.previous();
    expect(player.index, lines[2]);
  });

  testWidgets('the learner\'s turn waits, counting down', (t) async {
    final device = SpeakingDevice();
    final lesson = buildAudioLesson(planOf('es_greet_and_introduce'), narration);
    final player = AudioLessonPlayer(
      lesson: lesson,
      voice: LineVoice(source: LineVoiceSource.device, locale: 'es-ES', speech: device),
    );
    addTearDown(player.dispose);
    final turn = lesson.steps.indexWhere((s) => s.kind == AudioStepKind.yourTurn);
    player.seek(turn);
    final play = player.play();
    await t.pump(lesson.steps[turn].duration ~/ 2);
    expect(player.index, turn);
    expect(player.waited, closeTo(0.5, 0.1));
    await t.pump(lesson.steps[turn].duration);
    expect(player.index, greaterThan(turn));
    player.pause();
    await t.pump(const Duration(seconds: 2));
    await play;
  });

  testWidgets('the Audio tab lists a lesson per mission; a lesson plays, shows what is said, and is marked listened', (t) async {
    final device = SpeakingDevice();
    t.view.physicalSize = const Size(390 * 3, 844 * 3);
    t.view.devicePixelRatio = 3;
    addTearDown(t.view.reset);
    await t.pumpWidget(ProviderScope(overrides: [...await testOverrides(), speechServiceProvider.overrideWithValue(device)], child: const LangQuestApp()));
    final container = ProviderScope.containerOf(t.element(find.byType(LangQuestApp)));
    container.read(appStateProvider.notifier)
      ..setReduceMotion(true)
      ..enroll('spanish-spain', 'en');
    container.read(appRouterProvider).go('/');
    for (var i = 0; i < 10; i++) {
      await t.pump(const Duration(milliseconds: 100));
    }
    expect(find.text('Audio'), findsOneWidget, reason: 'the device has a Spain Spanish voice');
    await t.tap(find.text('Audio'));
    for (var i = 0; i < 10; i++) {
      await t.pump(const Duration(milliseconds: 100));
    }
    expect(find.text('Audio lessons'), findsOneWidget);
    expect(find.text('Read by your device’s voice'), findsOneWidget);
    final plan = planOf('es_greet_and_introduce');
    final title = plan.mission.titleIn('en')!;
    await t.tap(find.text(title).first);
    for (var i = 0; i < 10; i++) {
      await t.pump(const Duration(milliseconds: 100));
    }
    expect(find.text('AUDIO LESSON'), findsOneWidget);
    await t.tap(find.bySemanticsLabel('Play'));
    await t.pump(const Duration(milliseconds: 300));
    expect(device.said.first.$1, '$title. Listen to the conversation.');
    // Through to the end (turns included): the lesson is listened.
    for (var i = 0; i < 400 && !find.text('Lesson finished').evaluate().isNotEmpty; i++) {
      await t.pump(const Duration(milliseconds: 500));
    }
    expect(find.text('Lesson finished'), findsOneWidget);
    expect(container.read(audioListenedProvider)['spanish-spain|en'], {'es_greet_and_introduce'});
  });

  testWidgets('without any voice for the course there is no Audio tab', (t) async {
    t.view.physicalSize = const Size(390 * 3, 844 * 3);
    t.view.devicePixelRatio = 3;
    addTearDown(t.view.reset);
    await t.pumpWidget(await testApp());
    final container = ProviderScope.containerOf(t.element(find.byType(LangQuestApp)));
    container.read(appStateProvider.notifier).enroll('spanish-spain', 'en');
    for (var i = 0; i < 10; i++) {
      await t.pump(const Duration(milliseconds: 100));
    }
    expect(find.text('Audio'), findsNothing);
  });
}
