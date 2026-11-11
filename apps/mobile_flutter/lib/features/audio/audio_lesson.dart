import 'package:flutter/foundation.dart';

import '../../core/content/content_models.dart';
import '../learn/learn_content.dart';

/// The three parts of an audio lesson.
enum AudioSection {
  /// The mission's conversation, line by line.
  conversation,

  /// Each phrase: its meaning, the phrase slowly, a pause to say it, the phrase again.
  phraseByPhrase,

  /// The conversation once more, now that every phrase is known.
  conversationAgain,
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
      duration = Duration.zero;

  const AudioStep.say(Expression this.expression, {required this.section, this.speaker, this.slow = false})
    : kind = AudioStepKind.say,
      text = '',
      duration = Duration.zero;

  const AudioStep.yourTurn(Expression this.expression, {required this.section, required this.duration})
    : kind = AudioStepKind.yourTurn,
      text = '',
      speaker = null,
      slow = false;

  const AudioStep.pause(this.duration, {required this.section}) : kind = AudioStepKind.pause, text = '', expression = null, speaker = null, slow = false;

  final AudioStepKind kind;
  final AudioSection section;

  /// What is narrated (narrate steps).
  final String text;

  /// The line said (say steps) or to be said (yourTurn steps).
  final Expression? expression;

  /// Who says the line in the conversation (null in the phrase drill).
  final String? speaker;
  final bool slow;

  /// How long a pause or a turn lasts.
  final Duration duration;
}

@immutable
class AudioLesson {
  const AudioLesson({required this.missionKey, required this.title, required this.steps, required this.phraseCount});

  final String missionKey;
  final String title;
  final List<AudioStep> steps;
  final int phraseCount;

  /// The rough length of the lesson (speech is estimated from the text; the device's or the server's voice decides).
  Duration get estimatedLength => steps.fold(Duration.zero, (sum, s) => sum + estimateOf(s));

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
  const AudioNarration({required this.intro, required this.phrasesIntro, required this.againIntro, required this.outro});

  /// "Listen to the conversation." (with the mission's title)
  final String Function(String mission) intro;

  /// "Now phrase by phrase: listen, then say it."
  final String phrasesIntro;

  /// "Once more, the whole conversation."
  final String againIntro;

  /// "That's the lesson."
  final String outro;
}

/// The audio lesson of one mission, built from what its Learn stop teaches: nothing is added that the mission does
/// not contain. The learner's turn gives time in proportion to the phrase (at least 2.5 s).
AudioLesson buildAudioLesson(MissionLearnPlan plan, AudioNarration words) {
  final title = plan.mission.titleIn(plan.source) ?? '';
  final steps = <AudioStep>[
    AudioStep.narrate(words.intro(title), section: AudioSection.conversation),
    for (final line in plan.sceneLines) ...[
      AudioStep.say(line.expression, section: AudioSection.conversation, speaker: line.speakerName),
      const AudioStep.pause(Duration(milliseconds: 700), section: AudioSection.conversation),
    ],
    if (plan.phrases.isNotEmpty) AudioStep.narrate(words.phrasesIntro, section: AudioSection.phraseByPhrase),
    for (final phrase in plan.phrases) ...[
      AudioStep.narrate(plan.shortMeaningOf(phrase), section: AudioSection.phraseByPhrase),
      const AudioStep.pause(Duration(milliseconds: 500), section: AudioSection.phraseByPhrase),
      AudioStep.say(phrase, section: AudioSection.phraseByPhrase, slow: true),
      AudioStep.yourTurn(
        phrase,
        section: AudioSection.phraseByPhrase,
        duration: Duration(milliseconds: (2500 + 90 * phrase.text.length).clamp(2500, 6000)),
      ),
      AudioStep.say(phrase, section: AudioSection.phraseByPhrase),
      const AudioStep.pause(Duration(milliseconds: 900), section: AudioSection.phraseByPhrase),
    ],
    if (plan.sceneLines.isNotEmpty) AudioStep.narrate(words.againIntro, section: AudioSection.conversationAgain),
    for (final line in plan.sceneLines) ...[
      AudioStep.say(line.expression, section: AudioSection.conversationAgain, speaker: line.speakerName),
      const AudioStep.pause(Duration(milliseconds: 500), section: AudioSection.conversationAgain),
    ],
    AudioStep.narrate(words.outro, section: AudioSection.conversationAgain),
  ];
  return AudioLesson(missionKey: plan.mission.key, title: title, steps: steps, phraseCount: plan.phrases.length);
}
