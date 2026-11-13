// Lists every sentence the narrator can say, per course and instruction language, for the recorded narration
// (`scripts/src/synthesize-narration.ts` records them; the app plays them through `BundledNarrator`).
//
// Run: flutter test tool/narration_texts_test.dart  → writes build/narration_texts.json
//   { "<track>": { "<source>": ["sentence", …] } }
@TestOn('vm')
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:langquest_mobile/core/backend/narrator.dart';
import 'package:langquest_mobile/features/audio/audio_lesson.dart';
import 'package:langquest_mobile/features/audio/audio_screens.dart';
import 'package:langquest_mobile/features/learn/learn_content.dart';

import '../test/support.dart';

void main() {
  test('every narrated sentence', () {
    final out = <String, Map<String, List<String>>>{};
    for (final track in testBundle.tracks) {
      for (final source in testBundle.sourcesFor(track.id)) {
        final words = narrationWords(source);
        final course = testBundle.course(track.id, source);
        if (words == null || course == null) continue;
        final texts = <String>{words.missionWhatDoYouAnswer, words.sceneYourLine};
        final plans = <MissionLearnPlan>[];
        for (final mission in course.missions) {
          final plan = buildLearnPlan(mission: mission, track: course.track, source: source, character: testBundle.characterOf(mission));
          plans.add(plan);
          final note = mission.sceneNoteIn(source);
          if (note != null) texts.add(note);
          texts.add(words.missionCue(plan.characterName));
          // A mission's prompts and the review's cards: "How do you say “…”?".
          for (final e in plan.exchanges) {
            texts.add(words.missionHowDoYouSay(plan.promptMeaningOf(e.answer)));
          }
          for (final e in plan.phrases) {
            texts.add(words.missionHowDoYouSay(plan.promptMeaningOf(e)));
          }
          for (final step in buildAudioLesson(plan, narrationOf(words)).steps) {
            if (step.kind == AudioStepKind.narrate) texts.add(step.text);
          }
        }
        for (final lesson in [
          buildConversationsMix(plans, narrationOf(words), title: ''),
          buildRecallMix(plans, narrationOf(words), title: ''),
        ]) {
          for (final step in lesson.steps) {
            if (step.kind == AudioStepKind.narrate) texts.add(step.text);
          }
        }
        texts.removeWhere((t) => t.trim().isEmpty);
        (out[track.id] ??= {})[source] = texts.toList()..sort();
      }
    }
    final file = File('build/narration_texts.json')..createSync(recursive: true);
    file.writeAsStringSync(const JsonEncoder.withIndent(' ').convert(out));
    final all = [for (final t in out.values) for (final s in t.values) ...s];
    // ignore: avoid_print
    print('${out.length} courses, ${all.length} sentences, ${all.toSet().length} distinct, ${all.toSet().fold<int>(0, (n, t) => n + t.length)} characters');
  });
}
