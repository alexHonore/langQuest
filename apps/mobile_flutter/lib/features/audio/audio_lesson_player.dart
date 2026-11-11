import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../core/backend/server_voice.dart';
import 'audio_lesson.dart';

/// Plays an audio lesson step by step. Pausing stops the voice at once; [seek], [next] and [previous] move between
/// lines. Lines are said by the course's [voice] (the device's, or the server's AI voice); narration in the
/// learner's language by [narrate] when the device has a voice for it, else it is shown for its reading time.
class AudioLessonPlayer extends ChangeNotifier {
  AudioLessonPlayer({required this.lesson, required this.voice, this.narrate, this.onFinished});

  final AudioLesson lesson;
  final LineVoice voice;
  final Future<void> Function(String text)? narrate;
  final VoidCallback? onFinished;

  int index = 0;
  bool playing = false;
  bool finished = false;

  /// Every line slowly.
  bool slow = false;

  /// The pauses to say each phrase (off: the phrases follow each other).
  bool turns = true;

  /// At each turn the lesson waits for the learner to say the phrase (a take, checked where the server can) instead
  /// of a timed pause; the screen sets it where the device records and speaking is not paused.
  bool speakAtTurns = false;

  /// The lesson is waiting for the learner to say the current phrase ([spoke] goes on).
  bool awaitingSpeech = false;
  Completer<void>? _speech;

  /// How much of the current turn or pause has passed, 0–1.
  double waited = 0;

  int _run = 0;
  Completer<void>? _wait;
  Timer? _ticker;
  bool _disposed = false;

  AudioStep get current => lesson.steps[index.clamp(0, lesson.steps.length - 1)];

  /// The steps that are lines (what the transcript lists and next / previous move between).
  Iterable<int> get lineIndexes sync* {
    for (var i = 0; i < lesson.steps.length; i++) {
      if (lesson.steps[i].kind == AudioStepKind.say) yield i;
    }
  }

  void _changed() {
    if (!_disposed) notifyListeners();
  }

  Future<void> play() async {
    if (playing || _disposed) return;
    if (finished) {
      index = 0;
      finished = false;
    }
    playing = true;
    _changed();
    final first = lineIndexes.where((i) => i >= index).firstOrNull;
    if (first != null) voice.prepare(lesson.steps[first].expression!.id, slow: lesson.steps[first].slow || slow);
    final run = ++_run;
    while (run == _run) {
      await _perform(lesson.steps[index], run);
      if (run != _run) return;
      if (index >= lesson.steps.length - 1) {
        playing = false;
        finished = true;
        _changed();
        onFinished?.call();
        return;
      }
      index++;
      waited = 0;
      _changed();
    }
  }

  Future<void> _perform(AudioStep step, int run) async {
    switch (step.kind) {
      case AudioStepKind.narrate:
        final say = narrate;
        if (say != null) {
          await say(step.text);
        } else {
          await _sleep(AudioLesson.estimateOf(step), run);
        }
      case AudioStepKind.say:
        final line = step.expression!;
        // The next two lines are fetched while this one plays, so lines follow each other without a gap.
        for (final i in lineIndexes.where((i) => i > index).take(2)) {
          final next = lesson.steps[i];
          voice.prepare(next.expression!.id, slow: next.slow || slow);
        }
        await voice.say(text: line.text, expressionId: line.id, slow: step.slow || slow);
      case AudioStepKind.yourTurn:
        if (speakAtTurns) {
          await _awaitSpeech(run);
        } else if (turns) {
          await _sleep(step.duration, run);
        }
      case AudioStepKind.pause:
        await _sleep(step.duration, run);
    }
  }

  /// Waits until the learner said the phrase ([spoke]), or a pause or a jump ends the turn.
  Future<void> _awaitSpeech(int run) async {
    _finishWait();
    final done = Completer<void>();
    _speech = done;
    awaitingSpeech = true;
    _changed();
    await done.future;
    if (identical(_speech, done)) _speech = null;
    awaitingSpeech = false;
    _changed();
  }

  /// The learner said the phrase of this turn (or chose to go on): the lesson continues.
  void spoke() {
    final speech = _speech;
    if (speech != null && !speech.isCompleted) speech.complete();
  }

  /// Speaking at turns switched on or off (paused with "Can't speak now"): a turn waiting for speech goes on.
  void setSpeakAtTurns(bool value) {
    if (speakAtTurns == value) return;
    speakAtTurns = value;
    if (!value) spoke();
    _changed();
  }

  /// Waits [duration] (ended early by a pause or a jump), counting [waited] up.
  Future<void> _sleep(Duration duration, int run) {
    _finishWait();
    if (duration <= Duration.zero) return Future.value();
    final done = Completer<void>();
    _wait = done;
    // Time is counted in ticks of the timer (not a stopwatch), so a paused or slowed clock never ends a wait early.
    const tick = 50;
    var elapsed = 0;
    _ticker = Timer.periodic(const Duration(milliseconds: tick), (timer) {
      if (run != _run) {
        timer.cancel();
        if (!done.isCompleted) done.complete();
        return;
      }
      elapsed += tick;
      waited = (elapsed / duration.inMilliseconds).clamp(0.0, 1.0);
      _changed();
      if (elapsed >= duration.inMilliseconds) {
        timer.cancel();
        if (!done.isCompleted) done.complete();
      }
    });
    return done.future;
  }

  void _finishWait() {
    _ticker?.cancel();
    _ticker = null;
    final speech = _speech;
    _speech = null;
    if (speech != null && !speech.isCompleted) speech.complete();
    final wait = _wait;
    _wait = null;
    if (wait != null && !wait.isCompleted) wait.complete();
  }

  void pause() {
    if (!playing) return;
    playing = false;
    _run++;
    _finishWait();
    unawaited(voice.speech.stop());
    _changed();
  }

  void toggle() => playing ? pause() : play();

  /// Jumps to step [to] and keeps playing if it was.
  void seek(int to) {
    final wasPlaying = playing;
    pause();
    index = to.clamp(0, lesson.steps.length - 1);
    finished = false;
    waited = 0;
    _changed();
    if (wasPlaying) unawaited(play());
  }

  /// The next line (or the end). Not while the lesson waits for the learner to say the phrase.
  void next() {
    if (awaitingSpeech) return;
    final after = lineIndexes.where((i) => i > index);
    seek(after.isEmpty ? lesson.steps.length - 1 : after.first);
  }

  /// The line playing again, or the one before when it has just started.
  void previous() {
    final before = lineIndexes.where((i) => i < index).toList();
    seek(before.isEmpty ? 0 : before.last);
  }

  void setSlow(bool value) {
    slow = value;
    _changed();
  }

  void setTurns(bool value) {
    turns = value;
    _changed();
  }

  @override
  void dispose() {
    pause();
    _disposed = true;
    super.dispose();
  }
}
