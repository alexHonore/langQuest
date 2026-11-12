import 'package:flutter/foundation.dart';

import '../../core/content/content_models.dart';
import '../learn/learn_content.dart';
import '../learn/learn_logic.dart';

/// The parts of an audio lesson, in the order a mission's lesson goes through them: listen, repeat, recall, take part.
enum AudioSection {
  /// The mission's conversation, line by line.
  conversation,

  /// Each phrase: its meaning, the phrase slowly, a pause to say it, the phrase again.
  phraseByPhrase,

  /// From memory: a meaning is asked, the learner says the phrase, then hears it.
  recall,

  /// The conversation again, with the learner's lines left to the learner (each is then said, to check).
  rolePlay,
}

enum AudioStepKind {
  /// A sentence in the learner's language (the device voice for that language reads it, or it is shown only).
  narrate,

  /// A line of the course (the device's voice for the course, or the server's AI voice).
  say,

  /// Time to say the phrase out loud.
  yourTurn,

  /// A short silence between lines.
  pause,
}

@immutable
class AudioStep {
  const AudioStep.narrate(this.text, {required this.section})
    : kind = AudioStepKind.narrate,
      expression = null,
      speaker = null,
      slow = false,
      fromMemory = false,
      origin = null,
      duration = Duration.zero;

  const AudioStep.say(Expression this.expression, {required this.section, this.speaker, this.slow = false, this.origin})
    : kind = AudioStepKind.say,
      text = '',
      fromMemory = false,
      duration = Duration.zero;

  const AudioStep.yourTurn(Expression this.expression, {required this.section, required this.duration, this.fromMemory = false, this.origin})
    : kind = AudioStepKind.yourTurn,
      text = '',
      speaker = null,
      slow = false;

  const AudioStep.pause(this.duration, {required this.section})
    : kind = AudioStepKind.pause,
      text = '',
      expression = null,
      speaker = null,
      slow = false,
      fromMemory = false,
      origin = null;

  final AudioStepKind kind;
  final AudioSection section;

  /// What is narrated (narrate steps).
  final String text;

  /// The line said (say steps) or to be said (yourTurn steps).
  final Expression? expression;

  /// Who says the line in the conversation (null in the phrase drill).
  final String? speaker;
  final bool slow;

  /// A turn where the phrase is to be found again, not repeated: it is not shown until it has been said.
  final bool fromMemory;

  /// The mission the line comes from (a mix draws from several): its meanings, and what a checked take is checked
  /// against.
  final MissionLearnPlan? origin;

  /// How long a pause or a turn lasts.
  final Duration duration;
}

@immutable
class AudioLesson {
  const AudioLesson({required this.id, required this.title, required this.steps, required this.phraseCount});

  /// What the lesson is listened as: its mission's key, or a mix's id ([AudioMix.id]).
  final String id;
  final String title;
  final List<AudioStep> steps;
  final int phraseCount;

  /// The rough length of the lesson (speech is estimated from the text; the device's or the server's voice decides).
  Duration get estimatedLength => lengthFrom(0);

  /// The rough time left from step [index] on.
  Duration lengthFrom(int index) => steps.skip(index).fold(Duration.zero, (sum, s) => sum + estimateOf(s));

  /// The parts this lesson has, in order.
  List<AudioSection> get sections => [
    for (final section in AudioSection.values)
      if (steps.any((s) => s.section == section)) section,
  ];

  /// The first step of [section].
  int startOf(AudioSection section) => steps.indexWhere((s) => s.section == section);

  static Duration estimateOf(AudioStep step) => switch (step.kind) {
    AudioStepKind.narrate => Duration(milliseconds: 400 + 62 * step.text.length),
    AudioStepKind.say => Duration(milliseconds: 500 + (step.slow ? 110 : 80) * step.expression!.text.length),
    AudioStepKind.yourTurn || AudioStepKind.pause => step.duration,
  };
}

/// Words the narration needs in the learner's language (from the app's translations).
@immutable
class AudioNarration {
  const AudioNarration({
    required this.intro,
    required this.phrasesIntro,
    required this.recallIntro,
    required this.recallPrompt,
    required this.rolePlayIntro,
    required this.sayCue,
    required this.outro,
    required this.mixConversationsIntro,
    required this.mixRecallIntro,
  });

  /// "Listen to the conversation." (with the mission's title)
  final String Function(String mission) intro;

  /// "Now phrase by phrase: listen, then say it."
  final String phrasesIntro;

  /// "Now from memory: say each phrase before you hear it."
  final String recallIntro;

  /// "How do you say “…”?"
  final String Function(String meaning) recallPrompt;

  /// "Your turn to take part: answer out loud, then listen to check."
  final String rolePlayIntro;

  /// "Say: …" — what the learner's next line of the conversation means.
  final String Function(String meaning) sayCue;

  /// "That's the lesson."
  final String outro;

  /// "The chapter's conversations, one after the other."
  final String mixConversationsIntro;

  /// "From memory, the phrases you have learned."
  final String mixRecallIntro;
}

/// Time to say [phrase] out loud, in proportion to it (at least 2.5 s).
Duration turnLength(Expression phrase) => Duration(milliseconds: (2500 + 90 * phrase.text.length).clamp(2500, 6000));

/// The audio lesson of one mission, built from what its Learn stop teaches: nothing is added that the mission does
/// not contain. Four parts — the conversation heard; each phrase slowly, with time to repeat it; the phrases again
/// from memory, asked by their meaning in another order; then the conversation with the learner's lines left to the
/// learner. The learner's turn gives time in proportion to the phrase.
AudioLesson buildAudioLesson(MissionLearnPlan plan, AudioNarration words) {
  final title = plan.mission.titleIn(plan.source) ?? '';
  final recalled = stableShuffle(plan.pairPhrases, '${plan.mission.key}/audio/recall', (e) => e.id);
  // Taking part needs someone to answer and something to say.
  final rolePlay = plan.sceneLines.any((l) => l.byLearner) && plan.sceneLines.any((l) => !l.byLearner);
  final steps = <AudioStep>[
    AudioStep.narrate(words.intro(title), section: AudioSection.conversation),
    for (final line in plan.sceneLines) ...[
      AudioStep.say(line.expression, section: AudioSection.conversation, speaker: line.speakerName, origin: plan),
      const AudioStep.pause(Duration(milliseconds: 700), section: AudioSection.conversation),
    ],
    if (plan.phrases.isNotEmpty) AudioStep.narrate(words.phrasesIntro, section: AudioSection.phraseByPhrase),
    for (final phrase in plan.phrases) ...[
      AudioStep.narrate(plan.shortMeaningOf(phrase), section: AudioSection.phraseByPhrase),
      const AudioStep.pause(Duration(milliseconds: 500), section: AudioSection.phraseByPhrase),
      AudioStep.say(phrase, section: AudioSection.phraseByPhrase, slow: true, origin: plan),
      AudioStep.yourTurn(phrase, section: AudioSection.phraseByPhrase, duration: turnLength(phrase), origin: plan),
      AudioStep.say(phrase, section: AudioSection.phraseByPhrase, origin: plan),
      const AudioStep.pause(Duration(milliseconds: 900), section: AudioSection.phraseByPhrase),
    ],
    if (recalled.isNotEmpty) AudioStep.narrate(words.recallIntro, section: AudioSection.recall),
    for (final phrase in recalled) ..._recall(plan, phrase, words),
    if (rolePlay) ...[
      AudioStep.narrate(words.rolePlayIntro, section: AudioSection.rolePlay),
      for (final line in plan.sceneLines)
        if (line.byLearner) ...[
          AudioStep.narrate(words.sayCue(plan.promptMeaningOf(line.expression)), section: AudioSection.rolePlay),
          AudioStep.yourTurn(line.expression, section: AudioSection.rolePlay, duration: turnLength(line.expression), fromMemory: true, origin: plan),
          AudioStep.say(line.expression, section: AudioSection.rolePlay, speaker: line.speakerName, origin: plan),
          const AudioStep.pause(Duration(milliseconds: 600), section: AudioSection.rolePlay),
        ] else ...[
          AudioStep.say(line.expression, section: AudioSection.rolePlay, speaker: line.speakerName, origin: plan),
          const AudioStep.pause(Duration(milliseconds: 500), section: AudioSection.rolePlay),
        ],
    ],
    AudioStep.narrate(words.outro, section: rolePlay ? AudioSection.rolePlay : (recalled.isNotEmpty ? AudioSection.recall : AudioSection.conversation)),
  ];
  return AudioLesson(id: plan.mission.key, title: title, steps: steps, phraseCount: plan.phrases.length);
}

/// One phrase asked from memory: its meaning as a question, time to say it, then the phrase.
List<AudioStep> _recall(MissionLearnPlan plan, Expression phrase, AudioNarration words) => [
  AudioStep.narrate(words.recallPrompt(plan.promptMeaningOf(phrase)), section: AudioSection.recall),
  AudioStep.yourTurn(phrase, section: AudioSection.recall, duration: turnLength(phrase), fromMemory: true, origin: plan),
  AudioStep.say(phrase, section: AudioSection.recall, origin: plan),
  const AudioStep.pause(Duration(milliseconds: 800), section: AudioSection.recall),
];

/// The lessons made from a whole course rather than one mission.
enum AudioMix {
  /// Every conversation of the course, one after the other: listening only.
  conversations('conversations'),

  /// From memory, phrases of the missions already learned, mixed.
  recall('recall');

  const AudioMix(this.kind);

  /// The mix's name in routes (`/audio/mix/<kind>`).
  final String kind;

  /// What the mix is listened as ([AudioLesson.id]).
  String get id => 'mix:$kind';

  static AudioMix? of(String kind) => AudioMix.values.where((m) => m.kind == kind).firstOrNull;
}

/// The most phrases a recall mix asks for in one sitting.
const maxMixRecallPhrases = 14;

/// Every conversation of [plans] (a course's missions, in order), one after the other, each announced by its title.
AudioLesson buildConversationsMix(List<MissionLearnPlan> plans, AudioNarration words, {required String title}) {
  final steps = <AudioStep>[
    AudioStep.narrate(words.mixConversationsIntro, section: AudioSection.conversation),
    for (final plan in plans)
      if (plan.sceneLines.isNotEmpty) ...[
        AudioStep.narrate(plan.mission.titleIn(plan.source) ?? '', section: AudioSection.conversation),
        for (final line in plan.sceneLines) ...[
          AudioStep.say(line.expression, section: AudioSection.conversation, speaker: line.speakerName, origin: plan),
          const AudioStep.pause(Duration(milliseconds: 600), section: AudioSection.conversation),
        ],
        const AudioStep.pause(Duration(milliseconds: 900), section: AudioSection.conversation),
      ],
    AudioStep.narrate(words.outro, section: AudioSection.conversation),
  ];
  return AudioLesson(id: AudioMix.conversations.id, title: title, steps: steps, phraseCount: plans.fold(0, (sum, p) => sum + p.sceneLines.length));
}

/// The phrases of [learned] (the missions whose Learn stop is done, in order) asked from memory, mixed: one phrase
/// per meaning, at most [maxMixRecallPhrases], in an order that changes as more missions are learned.
AudioLesson buildRecallMix(List<MissionLearnPlan> learned, AudioNarration words, {required String title}) {
  final meanings = <String>{};
  final phrases = <(MissionLearnPlan, Expression)>[
    for (final plan in learned)
      for (final e in plan.pairPhrases)
        if (meanings.add(normalizeForCompare(plan.shortMeaningOf(e)))) (plan, e),
  ];
  final asked = stableShuffle(phrases, 'audio/mix/recall/${learned.length}', (p) => p.$2.id).take(maxMixRecallPhrases).toList();
  final steps = <AudioStep>[
    AudioStep.narrate(words.mixRecallIntro, section: AudioSection.recall),
    for (final (plan, phrase) in asked) ..._recall(plan, phrase, words),
    AudioStep.narrate(words.outro, section: AudioSection.recall),
  ];
  return AudioLesson(id: AudioMix.recall.id, title: title, steps: steps, phraseCount: asked.length);
}
