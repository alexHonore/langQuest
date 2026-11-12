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
import 'package:langquest_mobile/features/learn/learn_logic.dart';
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

const narration = AudioNarration(
  intro: _intro,
  phrasesIntro: 'Phrase by phrase.',
  recallIntro: 'From memory.',
  recallPrompt: _ask,
  rolePlayIntro: 'Your part.',
  sayCue: _cue,
  outro: 'The end.',
  mixConversationsIntro: 'Every conversation.',
  mixRecallIntro: 'What you learned, from memory.',
);
String _intro(String mission) => 'Intro: $mission';
String _ask(String meaning) => 'How do you say “$meaning”?';
String _cue(String meaning) => 'Say: $meaning';

MissionLearnPlan planOf(String key) {
  final mission = testBundle.mission(key)!;
  return buildLearnPlan(mission: mission, track: testBundle.track('spanish-spain')!, source: 'en', character: testBundle.characterOf(mission));
}

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  test('a lesson goes four ways: the conversation, each phrase to repeat, the phrases from memory, then the learner\'s part', () {
    final plan = planOf('es_cafe_order_drink');
    final lesson = buildAudioLesson(plan, narration);
    final steps = lesson.steps;
    expect(lesson.id, plan.mission.key);
    expect(lesson.sections, AudioSection.values);
    expect([
      for (final section in AudioSection.values) lesson.startOf(section),
    ], orderedEquals([for (final section in AudioSection.values) lesson.startOf(section)]..sort()));
    expect(steps.first.text, 'Intro: ${plan.mission.titleIn('en')}');
    final lines = [for (final l in plan.sceneLines) l.expression.id];
    List<Object?> in_(AudioSection section) => [
      for (final s in steps.where((s) => s.section == section && s.kind != AudioStepKind.pause)) (s.kind, s.expression?.id, s.slow, s.fromMemory),
    ];

    // 1. The conversation, heard.
    expect(in_(AudioSection.conversation), [(AudioStepKind.narrate, null, false, false), for (final id in lines) (AudioStepKind.say, id, false, false)]);

    // 2. Each phrase: its meaning, slowly, the learner's turn (the phrase in view), then at normal speed.
    expect(in_(AudioSection.phraseByPhrase), [
      (AudioStepKind.narrate, null, false, false),
      for (final p in plan.phrases) ...[
        (AudioStepKind.narrate, null, false, false),
        (AudioStepKind.say, p.id, true, false),
        (AudioStepKind.yourTurn, p.id, false, false),
        (AudioStepKind.say, p.id, false, false),
      ],
    ]);
    expect(steps.where((s) => s.kind == AudioStepKind.narrate).map((s) => s.text), containsAll([for (final p in plan.phrases) plan.shortMeaningOf(p)]));

    // 3. From memory: every phrase with a meaning of its own, asked by that meaning, in another order than taught;
    // the learner's turn comes before the phrase is said.
    final recall = in_(AudioSection.recall);
    expect(recall.first, (AudioStepKind.narrate, null, false, false));
    final recalled = [for (final s in steps.where((s) => s.section == AudioSection.recall && s.kind == AudioStepKind.yourTurn)) s.expression!.id];
    expect(recalled.toSet(), {for (final p in plan.pairPhrases) p.id});
    expect(recalled, isNot([for (final p in plan.pairPhrases) p.id]), reason: 'not in the order of the lesson');
    for (final id in recalled) {
      final turn = steps.indexWhere((s) => s.section == AudioSection.recall && s.kind == AudioStepKind.yourTurn && s.expression!.id == id);
      expect(steps[turn].fromMemory, isTrue);
      expect(steps[turn - 1].text, 'How do you say “${plan.promptMeaningOf(steps[turn].expression!)}”?');
      expect((steps[turn + 1].kind, steps[turn + 1].expression!.id), (AudioStepKind.say, id), reason: 'then the phrase, to check');
    }

    // 4. The conversation again: the character's lines are said; the learner's are theirs to say first.
    final part = steps.where((s) => s.section == AudioSection.rolePlay && s.kind != AudioStepKind.pause).toList();
    expect(part.first.text, 'Your part.');
    expect([for (final s in part.where((s) => s.kind == AudioStepKind.say)) s.expression!.id], lines);
    for (final line in plan.sceneLines.where((l) => l.byLearner)) {
      final turn = part.indexWhere((s) => s.kind == AudioStepKind.yourTurn && s.expression!.id == line.expression.id);
      expect(turn, greaterThan(0), reason: line.expression.text);
      expect(part[turn].fromMemory, isTrue);
      expect(part[turn - 1].text, 'Say: ${plan.promptMeaningOf(line.expression)}');
      expect(part[turn + 1].expression!.id, line.expression.id);
    }
    expect(part.where((s) => s.kind == AudioStepKind.yourTurn).length, plan.sceneLines.where((l) => l.byLearner).length);

    expect(steps.last.text, 'The end.');
    expect(lesson.phraseCount, plan.phrases.length);
    expect(lesson.estimatedLength, greaterThan(const Duration(minutes: 2)));
    expect(lesson.lengthFrom(lesson.startOf(AudioSection.rolePlay)), lessThan(lesson.estimatedLength));
    // Every line knows the mission it comes from (its meaning, and what a checked take is checked against).
    expect(steps.where((s) => s.expression != null).every((s) => identical(s.origin, plan)), isTrue);
  });

  test('a conversation where the learner says every line has no part to take: three parts', () {
    final plan = planOf('es_greet_and_introduce');
    expect(plan.sceneLines.every((l) => l.byLearner), isTrue);
    final lesson = buildAudioLesson(plan, narration);
    expect(lesson.sections, [AudioSection.conversation, AudioSection.phraseByPhrase, AudioSection.recall]);
    expect(lesson.steps.last.text, 'The end.');
  });

  test('every mission of every course makes a lesson whose turns are always followed by the phrase', () {
    for (final track in testBundle.tracks) {
      for (final source in testBundle.sourcesFor(track.id)) {
        for (final mission in testBundle.course(track.id, source)!.missions) {
          final plan = buildLearnPlan(mission: mission, track: track, source: source, character: testBundle.characterOf(mission));
          final steps = buildAudioLesson(plan, narration).steps;
          for (final (i, step) in steps.indexed) {
            if (step.kind != AudioStepKind.yourTurn) continue;
            final after = steps[i + 1];
            expect((after.kind, after.expression?.id), (AudioStepKind.say, step.expression!.id), reason: '${track.id}|$source ${mission.key}');
          }
        }
      }
    }
  });

  test('the mixes: every conversation back to back, and a recall of what was learned', () {
    final course = testBundle.course('spanish-spain', 'en')!;
    final plans = [for (final mission in course.missions) planOf(mission.key)];

    final conversations = buildConversationsMix(plans, narration, title: 'Every conversation');
    expect(conversations.id, 'mix:conversations');
    expect(conversations.sections, [AudioSection.conversation]);
    expect(conversations.steps.where((s) => s.kind == AudioStepKind.yourTurn), isEmpty, reason: 'listening only');
    expect(
      [for (final s in conversations.steps.where((s) => s.kind == AudioStepKind.say)) s.expression!.id],
      [
        for (final plan in plans)
          for (final line in plan.sceneLines) line.expression.id,
      ],
    );
    // Each conversation is announced by its mission's title.
    expect(
      conversations.steps.where((s) => s.kind == AudioStepKind.narrate).map((s) => s.text),
      containsAllInOrder([for (final plan in plans) plan.mission.titleIn('en')]),
    );

    final learned = plans.take(2).toList();
    final recall = buildRecallMix(learned, narration, title: 'Recall workout');
    expect(recall.id, 'mix:recall');
    expect(recall.sections, [AudioSection.recall]);
    final asked = [for (final s in recall.steps.where((s) => s.kind == AudioStepKind.yourTurn)) s];
    expect(asked.length, inInclusiveRange(4, maxMixRecallPhrases));
    expect(asked.every((s) => s.fromMemory), isTrue);
    expect({for (final s in asked) s.expression!.id}.length, asked.length, reason: 'no phrase twice');
    final taught = {
      for (final plan in learned)
        for (final e in plan.phrases) e.id,
    };
    expect(taught, containsAll([for (final s in asked) s.expression!.id]), reason: 'only what the learned missions taught');
    // Phrases of both missions, mixed (not one mission after the other).
    final origins = [for (final s in asked) s.origin!.mission.key];
    expect(origins.toSet(), {for (final plan in learned) plan.mission.key});
    expect(recall.phraseCount, asked.length);
    // One more mission learned: another order.
    final more = buildRecallMix(plans.take(3).toList(), narration, title: 'Recall workout');
    expect([for (final s in more.steps.where((s) => s.kind == AudioStepKind.yourTurn)) s.expression!.id], isNot([for (final s in asked) s.expression!.id]));
    expect(AudioMix.of('recall'), AudioMix.recall);
    expect(AudioMix.of('nope'), isNull);
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

  testWidgets('with a microphone, a turn waits for the phrase: next cannot skip it; said, the lesson goes on', (t) async {
    final device = SpeakingDevice();
    final lesson = buildAudioLesson(planOf('es_greet_and_introduce'), narration);
    final player = AudioLessonPlayer(
      lesson: lesson,
      voice: LineVoice(source: LineVoiceSource.device, locale: 'es-ES', speech: device),
      narrate: (text) => device.speak(text, locale: 'en-US'),
    )..speakAtTurns = true;
    addTearDown(player.dispose);
    final turn = lesson.steps.indexWhere((s) => s.kind == AudioStepKind.yourTurn);
    player.seek(turn);
    final play = player.play();
    await t.pump(const Duration(minutes: 2));
    expect((player.index, player.awaitingSpeech), (turn, true), reason: 'no timer: it waits for the phrase');
    player.next();
    expect(player.index, turn, reason: 'next does not skip the turn');
    player.spoke();
    await t.pump(const Duration(seconds: 1));
    expect(player.awaitingSpeech, isFalse);
    expect(player.index, greaterThan(turn));
    // "Can't speak now": turns go back to timed pauses, and a waiting turn goes on.
    player.setSpeakAtTurns(false);
    player.pause();
    await t.pump(const Duration(seconds: 1));
    await play;
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
    // A mission with a character to answer: its lesson has the four parts.
    final plan = planOf('es_cafe_order_drink');
    final title = plan.mission.titleIn('en')!;
    await t.tap(find.text(title).first);
    for (var i = 0; i < 10; i++) {
      await t.pump(const Duration(milliseconds: 100));
    }
    expect(find.text('Audio lesson'), findsOneWidget);
    // The four parts, and how long is left.
    for (final part in ['Listen', 'Repeat', 'Recall', 'Your part']) {
      expect(find.text(part), findsOneWidget, reason: part);
    }
    expect(find.textContaining('min left'), findsOneWidget);
    await t.tap(find.bySemanticsLabel('Play'));
    await t.pump(const Duration(milliseconds: 300));
    expect(device.said.first.$1, '$title. Listen to the conversation.');
    // On to the third part: the phrases asked from memory.
    for (var i = 0; i < 400 && !find.text('Your turn: say it from memory').evaluate().isNotEmpty; i++) {
      await t.pump(const Duration(milliseconds: 500));
    }
    expect(find.text('Your turn: say it from memory'), findsOneWidget);
    expect(device.said.map((s) => s.$1), contains('Now from memory. You hear a meaning: say the phrase before the voice does.'));
    // Through to the end (turns included): the lesson is listened.
    for (var i = 0; i < 800 && !find.text('Lesson finished').evaluate().isNotEmpty; i++) {
      await t.pump(const Duration(milliseconds: 500));
    }
    expect(find.text('Lesson finished'), findsOneWidget);
    expect(container.read(audioListenedProvider)['spanish-spain|en'], {'es_cafe_order_drink'});
    expect(device.said.map((s) => s.$1), contains('Now take your part in the conversation. Say your lines out loud, then listen to check.'));
  });

  testWidgets('the Audio tab offers the mixes: every conversation at once; the recall once a mission is learned', (t) async {
    final device = SpeakingDevice();
    t.view.physicalSize = const Size(390 * 3, 844 * 3);
    t.view.devicePixelRatio = 3;
    addTearDown(t.view.reset);
    await t.pumpWidget(ProviderScope(overrides: [...await testOverrides(), speechServiceProvider.overrideWithValue(device)], child: const LangQuestApp()));
    final container = ProviderScope.containerOf(t.element(find.byType(LangQuestApp)));
    final notifier = container.read(appStateProvider.notifier)
      ..setReduceMotion(true)
      ..enroll('spanish-spain', 'en');
    container.read(appRouterProvider).go('/audio');
    await t.pumpAndSettle();
    expect(find.text('Mixes'), findsOneWidget);
    expect(find.text('Every conversation'), findsOneWidget);
    // Every chapter: the device has a voice for the course, so every conversation can be heard.
    expect(find.text('24 conversations back to back, just to listen'), findsOneWidget);
    expect(find.text('Recall workout'), findsNothing, reason: 'nothing learned yet (visible means usable)');

    notifier.completeStop('es_greet_and_introduce', PathStop.learn);
    await t.pumpAndSettle();
    expect(find.text('Recall workout'), findsOneWidget);
    await t.tap(find.text('Recall workout'));
    await t.pumpAndSettle();
    expect(container.read(appRouterProvider).state.matchedLocation, '/audio/mix/recall');
    expect(find.text('Mix'), findsOneWidget);
    expect(find.text('Listen'), findsNothing, reason: 'a mix has one part: no tabs');
    await t.tap(find.bySemanticsLabel('Play'));
    await t.pump(const Duration(milliseconds: 300));
    expect(device.said.first.$1, 'From memory, the phrases you have learned. Say each one before the voice does.');
    // The first phrase asked: its meaning as the question, the phrase itself not written yet.
    final plan = planOf('es_greet_and_introduce');
    final asked = buildRecallMix([plan], narration, title: '').steps.firstWhere((s) => s.kind == AudioStepKind.yourTurn).expression!;
    for (var i = 0; i < 60 && !find.text('Your turn: say it from memory').evaluate().isNotEmpty; i++) {
      await t.pump(const Duration(milliseconds: 200));
    }
    expect(find.text('Your turn: say it from memory'), findsOneWidget);
    expect(find.text(asked.text), findsNothing, reason: 'to be found from memory');
    expect(find.text(plan.meaningOf(asked)), findsWidgets, reason: 'the question, and its place in the transcript');
    // A link to a mix that cannot be made (nothing learned in this course) shows the way back.
    container.read(appRouterProvider).go('/audio/mix/nope');
    await t.pumpAndSettle();
    expect(find.text('This mission is not part of your current course.'), findsOneWidget);
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
