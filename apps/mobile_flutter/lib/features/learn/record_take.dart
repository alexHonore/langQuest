import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart' show Bidi;
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/backend/account.dart';
import '../../core/backend/pronunciation_coach.dart';
import '../../core/backend/server_voice.dart';
import '../../core/audio/take_recorder.dart';
import '../../core/backend/speech_check.dart';
import '../../core/layout/motion.dart';
import '../../core/platform/browser_kind.dart';
import '../../core/platform/recorder.dart';
import '../../core/services/app_state.dart';
import '../../core/services/speaking_stats.dart';
import '../../core/services/speech_service.dart';
import '../../l10n/l10n.dart';
import 'learn_widgets.dart';

/// Makes the recorder for one take; null where recording is not available, and the record action is then not shown
/// (CONVENTIONS §8: visible means usable).
final takeRecorderFactoryProvider = Provider<TakeRecorder Function()?>((ref) => canRecordTakes ? createTakeRecorder : null);

enum _Take { idle, starting, recording, recorded, silent, blocked, noMicrophone, failed }

/// What a take of a speaking step came to: [recorded] (nothing could check it), [understood] or [notUnderstood] by the
/// server (a take it was unsure about counts as not understood: try again), or [unchecked] (the check failed).
enum TakeOutcome { recorded, understood, notUnderstood, unchecked }

/// "Can't speak now": speaking steps stop asking for a take for 15 minutes (a noisy place, no microphone at hand).
class SpeakingPause extends Notifier<DateTime?> {
  static const length = Duration(minutes: 15);

  @override
  DateTime? build() => null;

  void pause() => state = ref.read(clockProvider)().add(length);

  bool get active => state != null && ref.read(clockProvider)().isBefore(state!);
}

final speakingPauseProvider = NotifierProvider<SpeakingPause, DateTime?>(SpeakingPause.new);

/// A speaking step's rule: with a microphone (and not paused), the learner has to say the line before moving on: a
/// take the server understood, or any real take where nothing can check it, or [maxTries] takes not understood (the
/// line then goes to review as hard).
class SpeakingStep {
  static const maxTries = 3;

  int tries = 0;
  bool done = false;

  void reset() {
    tries = 0;
    done = false;
  }

  /// Records [outcome]; true when the step is now done.
  bool take(TakeOutcome outcome) {
    tries++;
    done = done || outcome != TakeOutcome.notUnderstood || tries >= maxTries;
    return done;
  }
}

/// Record yourself saying the line, then hear your take next to the reference voice: listen / record / compare
/// (ADR-006). No score, no level after the take, only the microphone level while recording, and a take whose loudest
/// moment stays under the server's silence floor is called what it is ("I didn't hear anything").
///
/// With a [check] and a signed-in learner whose course the server can check ([speechCheckerProvider]), the take is
/// sent to the server, which says whether its meaning came across: understood, not quite (with what it heard), or
/// unsure. That is a verdict on meaning, never a pronunciation score. Otherwise the take stays in memory on this device.
/// Either way it is dropped here when the line changes or the screen closes.
class RecordTake extends ConsumerStatefulWidget {
  /// The reference voice's locale: the comparison hint names Listen only when the device has that voice.
  final String? voiceLocale;

  /// Centered (the mission's answer card) or aligned to the start (the scene's line card).
  final bool centered;

  /// The phrase the take should say: checked by the server where it can.
  final SpeechTarget? check;

  /// Each verdict of the server on a take of this line.
  final ValueChanged<SpeechVerdict>? onVerdict;

  /// What each take came to (a speaking step moves on with it).
  final ValueChanged<TakeOutcome>? onTake;

  /// The AI's pronunciation feedback comes by itself after each take (signed in), not only on request.
  final bool autoFeedback;

  const RecordTake({super.key, this.voiceLocale, this.centered = false, this.check, this.onVerdict, this.onTake, this.autoFeedback = true});

  /// A take stops by itself after this long: a line takes a few seconds; this ends a forgotten recording.
  static const maxTake = Duration(seconds: 15);

  /// Shorter than this is a slip of the finger, not a take.
  static const minTake = Duration(milliseconds: 500);

  @override
  ConsumerState<RecordTake> createState() => _RecordTakeState();
}

class _RecordTakeState extends ConsumerState<RecordTake> {
  _Take _state = _Take.idle;
  TakeRecorder? _recorder;
  RecordedTake? _take;
  StreamSubscription<double>? _levels;
  Timer? _limit;
  Timer? _tick;

  /// Tenths of a second since the take started (counted by the timer that redraws the clock).
  int _tenths = 0;
  double _level = minLevelDbfs;
  bool _playing = false;

  /// The server is checking the take.
  bool _checking = false;

  /// The server's verdict on the take; null before (or without) a check.
  SpeechVerdict? _verdict;

  /// The check could not be made: the learner compares by ear.
  bool _checkFailed = false;

  /// AI pronunciation feedback on the current take: being fetched, the result, or that it failed.
  bool _coaching = false;
  PronunciationFeedback? _feedback;
  bool _feedbackFailed = false;

  @override
  void dispose() {
    _endRecording();
    _take?.dispose();
    super.dispose();
  }

  /// Stops the timers and releases the microphone.
  void _endRecording() {
    _limit?.cancel();
    _tick?.cancel();
    unawaited(_levels?.cancel());
    _levels = null;
    final recorder = _recorder;
    _recorder = null;
    if (recorder != null) unawaited(recorder.dispose());
  }

  Future<void> _start() async {
    final create = ref.read(takeRecorderFactoryProvider);
    if (create == null || _state == _Take.starting || _state == _Take.recording) return;
    _take?.dispose();
    _take = null;
    // The reference voice must not end up in the take.
    unawaited(ref.read(speechServiceProvider).stop());
    final recorder = create();
    _recorder = recorder;
    setState(() {
      _state = _Take.starting;
      _playing = false;
      _level = minLevelDbfs;
      _checking = false;
      _verdict = null;
      _checkFailed = false;
      _coaching = false;
      _feedback = null;
      _feedbackFailed = false;
    });
    final failure = await _open(recorder);
    // Closed meanwhile, or another take started: this one must not keep the microphone.
    if (!mounted || _recorder != recorder) {
      unawaited(recorder.dispose());
      return;
    }
    if (failure != null) {
      _endRecording();
      setState(() => _state = failure);
      return;
    }
    _tenths = 0;
    _levels = recorder.levels.listen((level) => _level = level);
    _tick = Timer.periodic(const Duration(milliseconds: 100), (_) {
      if (mounted) setState(() => _tenths++);
    });
    _limit = Timer(RecordTake.maxTake, _stop);
    setState(() => _state = _Take.recording);
  }

  /// Starts [recorder]: null once it records, else why it cannot. (A helper returning the outcome, rather than a local
  /// assigned in a catch clause and read by a closure: dart2js miscompiled that shape in `_start`.)
  static Future<_Take?> _open(TakeRecorder recorder) async {
    try {
      await recorder.start();
      return null;
    } on RecorderException catch (e) {
      return switch (e.failure) {
        RecorderFailure.blocked => _Take.blocked,
        RecorderFailure.noMicrophone => _Take.noMicrophone,
        RecorderFailure.failed => _Take.failed,
      };
    } catch (_) {
      return _Take.failed;
    }
  }

  /// Stops [recorder]: its take, or null when there is none.
  static Future<RecordedTake?> _close(TakeRecorder recorder) async {
    try {
      return await recorder.stop();
    } catch (_) {
      return null;
    }
  }

  Future<void> _stop() async {
    final recorder = _recorder;
    if (recorder == null || _state != _Take.recording) return;
    _recorder = null; // a second tap while stopping does nothing
    _limit?.cancel();
    _tick?.cancel();
    unawaited(_levels?.cancel());
    _levels = null;
    final take = await _close(recorder);
    unawaited(recorder.dispose());
    if (!mounted) {
      take?.dispose();
      return;
    }
    if (take == null) {
      setState(() => _state = _Take.failed);
    } else if (take.duration < RecordTake.minTake) {
      take.dispose();
      setState(() => _state = _Take.idle);
    } else if (isSilentTake(take.peakLevelDb)) {
      take.dispose();
      setState(() => _state = _Take.silent);
    } else {
      _take = take;
      setState(() => _state = _Take.recorded);
      final checked = widget.check != null && ref.read(speechCheckerProvider) != null;
      if (!checked) widget.onTake?.call(TakeOutcome.recorded);
      unawaited(_check(take));
      // Realtime feedback: how it sounded, without asking (a model call per take, signed in only).
      if (widget.autoFeedback && checked) unawaited(_coach());
    }
  }

  /// Has the server check [take] when this line has a target and the course can be checked.
  Future<void> _check(RecordedTake take) async {
    final checker = ref.read(speechCheckerProvider);
    final target = widget.check;
    if (checker == null || target == null) return;
    setState(() => _checking = true);
    final verdict = await _assess(checker, take, target);
    // Another take started meanwhile, or the line closed: this verdict is about nothing on screen.
    if (!mounted || _take != take) return;
    if (verdict?.kind == SpeechVerdictKind.noSpeech) {
      take.dispose();
      _take = null;
      setState(() {
        _checking = false;
        _coaching = false;
        _feedback = null;
        _state = _Take.silent;
      });
    } else {
      widget.onTake?.call(switch (verdict?.kind) {
        null => TakeOutcome.unchecked,
        SpeechVerdictKind.understood => TakeOutcome.understood,
        _ => TakeOutcome.notUnderstood,
      });
      setState(() {
        _checking = false;
        _verdict = verdict;
        _checkFailed = verdict == null;
      });
    }
    if (verdict != null) {
      // Progress counts the takes the server judged, and how many it understood.
      final courseId = ref.read(appStateProvider).activeCourse?.id;
      if (courseId != null && (verdict.kind == SpeechVerdictKind.understood || verdict.kind == SpeechVerdictKind.notUnderstood)) {
        ref.read(speakingStatsProvider.notifier).recordCheck(courseId, understood: verdict.understood);
      }
      widget.onVerdict?.call(verdict);
    }
  }

  /// Asks the AI how the current take sounded (on demand: each listen is a model call).
  Future<void> _coach() async {
    final coach = ref.read(pronunciationCoachProvider);
    final target = widget.check;
    final take = _take;
    if (coach == null || target == null || take == null || _coaching) return;
    setState(() {
      _coaching = true;
      _feedbackFailed = false;
    });
    final feedback = await _listen(coach, take, target);
    if (!mounted || _take != take) return;
    setState(() {
      _coaching = false;
      _feedback = feedback;
      _feedbackFailed = feedback == null;
    });
  }

  /// The AI's feedback on [take], or null when it could not be had (a helper returning the outcome; see [_open]).
  static Future<PronunciationFeedback?> _listen(PronunciationCoach coach, RecordedTake take, SpeechTarget target) async {
    try {
      return await coach.listen(take, target);
    } catch (_) {
      return null;
    }
  }

  /// The server's verdict on [take], or null when it could not be checked (a helper returning the outcome; see [_open]).
  static Future<SpeechVerdict?> _assess(SpeechChecker checker, RecordedTake take, SpeechTarget target) async {
    try {
      return await checker.check(take, target);
    } catch (_) {
      return null;
    }
  }

  Future<void> _play() async {
    final take = _take;
    if (take == null) return;
    if (_playing) {
      take.stop();
      return;
    }
    unawaited(ref.read(speechServiceProvider).stop());
    setState(() => _playing = true);
    await take.play();
    if (mounted && _take == take) setState(() => _playing = false);
  }

  @override
  Widget build(BuildContext context) {
    if (ref.watch(takeRecorderFactoryProvider) == null) return const SizedBox.shrink();
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    final l10n = context.l10n;
    final voiceLocale = widget.voiceLocale;
    final hasVoice = ref.watch(lineVoiceProvider(voiceLocale)).asData?.value.available ?? false;
    final note = TextStyle(fontSize: 12.5, height: 1.35, color: colors.textMuted);
    final checker = widget.check == null ? null : ref.watch(speechCheckerProvider);
    final coach = widget.check == null ? null : ref.watch(pronunciationCoachProvider);
    final idleNote = checker == null ? l10n.recordStaysOnDevice : (checker.keepsRecordings ? l10n.recordCheckedKept : l10n.recordChecked);

    final record = AudioChip(icon: LucideIcons.mic, label: l10n.recordYourself, onTap: _state == _Take.starting ? null : _start);
    final tryAgain = AudioChip(icon: LucideIcons.rotateCcw, label: l10n.recordTryAgain, onTap: _start);

    final (List<Widget> chips, String? message) = switch (_state) {
      _Take.idle || _Take.starting => ([record], idleNote),
      _Take.recording => (
        [
          AudioChip(
            icon: LucideIcons.square,
            label: l10n.recordStop,
            semanticsLabel: l10n.recordStopSemantics,
            background: colors.errorSoft,
            foreground: colors.error,
            onTap: _stop,
          ),
          ExcludeSemantics(
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                _LevelBars(level: _level, color: colors.error, idle: colors.border),
                const SizedBox(width: 8),
                Text(
                  _clock(Duration(milliseconds: _tenths * 100)),
                  style: note.copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
                ),
              ],
            ),
          ),
        ],
        null,
      ),
      _Take.recorded => (
        [
          AudioChip(
            icon: _playing ? LucideIcons.square : LucideIcons.play,
            label: _playing ? l10n.recordStop : l10n.recordMyVoice,
            semanticsLabel: _playing ? l10n.recordStopPlayingSemantics : l10n.recordMyVoiceSemantics,
            onTap: _play,
          ),
          AudioChip(icon: LucideIcons.rotateCcw, label: l10n.recordAgain, semanticsLabel: l10n.recordAgainSemantics, onTap: _start),
          if (coach != null && _feedback == null)
            AudioChip(
              icon: LucideIcons.sparkles,
              label: l10n.pronunciationButton,
              semanticsLabel: l10n.pronunciationButtonSemantics,
              onTap: _coaching ? null : _coach,
            ),
        ],
        // A checked take shows the verdict instead; a failed check falls back to comparing by ear.
        _checking || _verdict != null
            ? null
            : _checkFailed
            ? (hasVoice ? '${l10n.recordCheckFailed} ${l10n.recordCompare(l10n.listen, l10n.recordMyVoice)}' : l10n.recordCheckFailed)
            : (hasVoice ? l10n.recordCompare(l10n.listen, l10n.recordMyVoice) : null),
      ),
      _Take.silent => ([tryAgain], l10n.recordSilent),
      _Take.blocked => ([tryAgain], l10n.recordBlocked),
      _Take.noMicrophone => ([tryAgain], l10n.recordNoMicrophone),
      _Take.failed => ([tryAgain], l10n.recordFailed),
    };

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: widget.centered ? CrossAxisAlignment.center : CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          alignment: widget.centered ? WrapAlignment.center : WrapAlignment.start,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: chips,
        ),
        // Announced when it changes: recording started, the take is ready, or why there is none.
        Semantics(
          liveRegion: true,
          label: _state == _Take.recording ? l10n.recordingNow : null,
          child: message == null
              ? const SizedBox.shrink()
              : Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(message, textAlign: widget.centered ? TextAlign.center : TextAlign.start, style: note),
                ),
        ),
        // Signed out on a course the server checks: say what an account adds, right where it would help.
        if (_state == _Take.recorded && widget.check != null && checker == null && _checkableWithAccount(ref))
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: TextButton.icon(
              icon: const Icon(LucideIcons.sparkles, size: 16),
              label: Text(l10n.recordSignInToCheck, textAlign: widget.centered ? TextAlign.center : TextAlign.start),
              onPressed: () => context.push('/account'),
            ),
          ),
        // AI pronunciation feedback: by itself after each take (signed in), or once asked for.
        if (_state == _Take.recorded && (_coaching || _feedback != null || _feedbackFailed))
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Semantics(
              liveRegion: true,
              child: _coaching
                  ? _Checking(centered: widget.centered, label: l10n.pronunciationListening)
                  : _feedback != null
                  ? PronunciationPanel(feedback: _feedback!, centered: widget.centered)
                  : Text(l10n.pronunciationFailed, style: note),
            ),
          ),
        // Blocked: the steps to allow it, on this device.
        if (_state == _Take.blocked)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: MicHelp(centered: widget.centered),
          ),
        if (_state == _Take.recorded && (_checking || _verdict != null))
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Semantics(
              liveRegion: true,
              child: _checking ? _Checking(centered: widget.centered) : _VerdictPanel(verdict: _verdict!, centered: widget.centered),
            ),
          ),
      ],
    );
  }

  /// Signed out, on a course whose takes the server checks once signed in.
  static bool _checkableWithAccount(WidgetRef ref) {
    final account = ref.watch(accountProvider);
    final course = ref.watch(appStateProvider.select((s) => s.activeCourse));
    if (!account.available || account.user != null || course == null) return false;
    return ref.watch(serverOffersProvider(course.source)).asData?.value[course.track.id]?.spokenCheck ?? false;
  }

  static String _clock(Duration d) => '${d.inMinutes}:${(d.inSeconds % 60).toString().padLeft(2, '0')}';
}

/// [speakingRequired] outside a build (nothing watched).
bool speakingRequiredNow(WidgetRef ref) => ref.read(takeRecorderFactoryProvider) != null && !ref.read(speakingPauseProvider.notifier).active;

/// Whether speaking steps ask for a take here: the device records and the learner has not paused them.
bool speakingRequired(WidgetRef ref) {
  ref.watch(speakingPauseProvider);
  return ref.watch(takeRecorderFactoryProvider) != null && !ref.read(speakingPauseProvider.notifier).active;
}

/// Under a speaking step's continue button while it waits for the line: what to do, and "Can't speak now".
class SpeakingHint extends ConsumerWidget {
  const SpeakingHint({super.key, required this.tries});

  /// Takes not understood so far.
  final int tries;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    final l10n = context.l10n;
    return Semantics(
      container: true,
      liveRegion: true,
      child: Wrap(
        alignment: WrapAlignment.center,
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: 4,
        children: [
          Text(
            tries == 0 ? l10n.speakToContinue : l10n.speakTryAgain(tries, SpeakingStep.maxTries),
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 13, color: colors.textSecondary),
          ),
          TextButton(
            // The continue button comes alive at once (a snackbar here would cover it).
            onPressed: () => ref.read(speakingPauseProvider.notifier).pause(),
            child: Semantics(hint: l10n.speakCantNowDone, child: Text(l10n.speakCantNow)),
          ),
        ],
      ),
    );
  }
}

/// The browser the app runs in (for device-specific help); overridden in tests.
final browserKindProvider = Provider<BrowserKind>((ref) => currentBrowserKind());

/// "How to allow the microphone": a toggle that opens the steps for this device (iPhone/iPad Safari, Android Chrome,
/// a computer). The browser remembers a refusal per site, so the learner has to allow it there.
class MicHelp extends ConsumerStatefulWidget {
  const MicHelp({super.key, this.centered = false, this.initiallyOpen = false});

  final bool centered;
  final bool initiallyOpen;

  @override
  ConsumerState<MicHelp> createState() => _MicHelpState();
}

class _MicHelpState extends ConsumerState<MicHelp> {
  late bool _open = widget.initiallyOpen;

  @override
  Widget build(BuildContext context) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final steps = switch (ref.watch(browserKindProvider)) {
      BrowserKind.iosSafari => [l10n.micHelpIos],
      BrowserKind.android => [l10n.micHelpAndroid],
      BrowserKind.desktop => [l10n.micHelpDesktop],
      BrowserKind.other => [l10n.micHelpIos, l10n.micHelpAndroid, l10n.micHelpDesktop],
    };
    return Column(
      crossAxisAlignment: widget.centered ? CrossAxisAlignment.center : CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Semantics(
          container: true,
          button: true,
          expanded: _open,
          child: InkWell(
            borderRadius: BorderRadius.circular(10),
            onTap: () => setState(() => _open = !_open),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 44),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(LucideIcons.micOff, size: 16, color: accent.primaryText),
                  const SizedBox(width: 6),
                  Flexible(
                    child: Text(
                      l10n.micHelpTitle,
                      style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: accent.primaryText),
                    ),
                  ),
                  Icon(_open ? LucideIcons.chevronUp : LucideIcons.chevronDown, size: 16, color: accent.primaryText),
                ],
              ),
            ),
          ),
        ),
        if (_open)
          for (final step in steps)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text(
                step,
                textAlign: widget.centered ? TextAlign.center : TextAlign.start,
                style: TextStyle(fontSize: 13, height: 1.4, color: colors.textSecondary),
              ),
            ),
      ],
    );
  }
}

/// The microphone's level while recording, as five bars (decorative: the Stop button says what is happening).
class _LevelBars extends StatelessWidget {
  const _LevelBars({required this.level, required this.color, required this.idle});

  final double level;
  final Color color;
  final Color idle;

  @override
  Widget build(BuildContext context) {
    // −60 dBFS (room noise) to −10 dBFS (a loud voice close to the microphone).
    final amount = ((level + 60) / 50).clamp(0.0, 1.0);
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        for (var i = 0; i < 5; i++)
          Container(
            width: 4,
            height: 6.0 + i * 3,
            margin: const EdgeInsets.only(right: 3),
            decoration: BoxDecoration(color: amount > i / 5 ? color : idle, borderRadius: BorderRadius.circular(2)),
          ),
      ],
    );
  }
}

/// The server is listening to the take.
class _Checking extends ConsumerWidget {
  const _Checking({required this.centered, this.label});

  final bool centered;
  final String? label;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    return Row(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: centered ? MainAxisAlignment.center : MainAxisAlignment.start,
      children: [
        SizedBox.square(dimension: 14, child: CircularProgressIndicator(strokeWidth: 2, color: colors.textMuted)),
        const SizedBox(width: 8),
        Flexible(
          child: Text(label ?? context.l10n.recordChecking, style: TextStyle(fontSize: 13, color: colors.textSecondary)),
        ),
      ],
    );
  }
}

/// AI pronunciation feedback on a take: the score and its band, each word of the phrase coloured by how it sounded
/// (with its tip), the one thing to practise, what was heard next to what was expected (IPA), and a plain note that
/// this is an AI's estimate that does not count as progress.
class PronunciationPanel extends ConsumerWidget {
  const PronunciationPanel({super.key, required this.feedback, this.centered = false});

  final PronunciationFeedback feedback;
  final bool centered;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    final l10n = context.l10n;
    if (feedback.band == PronunciationBand.noSpeech) {
      return Text(l10n.pronunciationNoSpeech, style: TextStyle(fontSize: 13, color: colors.textMuted));
    }
    final (Color tone, Color soft, String band) = switch (feedback.band) {
      PronunciationBand.nativeLike => (colors.success, colors.successSoft, l10n.pronunciationNativeLike),
      PronunciationBand.clearAccent => (colors.info, colors.infoSoft, l10n.pronunciationClearAccent),
      PronunciationBand.hardToUnderstand => (colors.warning, colors.warningSoft, l10n.pronunciationHard),
      _ => (colors.error, colors.errorSoft, l10n.pronunciationOffTarget),
    };
    (Color, String) sound(WordSound s) => switch (s) {
      WordSound.good => (colors.success, l10n.pronunciationWordGood),
      WordSound.unclear => (colors.warning, l10n.pronunciationWordUnclear),
      WordSound.mispronounced => (colors.error, l10n.pronunciationWordToWork),
      WordSound.missing => (colors.textMuted, l10n.pronunciationWordMissing),
    };
    final score = feedback.score;
    final tips = [
      for (final w in feedback.words)
        if (w.sound != WordSound.good && w.tip != null) w,
    ];
    final panel = Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: soft,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: tone.withValues(alpha: 0.6)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (score != null)
                Semantics(
                  container: true,
                  label: '${l10n.pronunciationScore(score)}, $band',
                  excludeSemantics: true,
                  child: SizedBox.square(
                    dimension: 46,
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        CircularProgressIndicator(value: score / 100, strokeWidth: 4, color: tone, backgroundColor: tone.withValues(alpha: 0.18)),
                        Text(
                          '$score',
                          style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: colors.textPrimary),
                        ),
                      ],
                    ),
                  ),
                ).withMotion(context, (a) => a.scale(begin: const Offset(0.6, 0.6), duration: 360.ms, curve: Curves.easeOutBack)),
              const SizedBox(width: 10),
              Flexible(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    ExcludeSemantics(
                      child: Text(
                        band,
                        style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w800, color: colors.textPrimary),
                      ),
                    ),
                    if (feedback.summary.isNotEmpty) Text(feedback.summary, style: TextStyle(fontSize: 13, height: 1.35, color: colors.textSecondary)),
                  ],
                ),
              ),
            ],
          ),
          if (feedback.words.isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final w in feedback.words)
                  Semantics(
                    container: true,
                    label: l10n.pronunciationWordLabel(w.word, sound(w.sound).$2),
                    excludeSemantics: true,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                      decoration: BoxDecoration(
                        color: sound(w.sound).$1.withValues(alpha: 0.14),
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: sound(w.sound).$1.withValues(alpha: 0.7)),
                      ),
                      child: Text(
                        w.word,
                        textDirection: Bidi.detectRtlDirectionality(w.word) ? TextDirection.rtl : TextDirection.ltr,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: colors.textPrimary,
                          decoration: w.sound == WordSound.missing ? TextDecoration.lineThrough : null,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ],
          for (final w in tips)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: '${w.word} · ',
                      style: TextStyle(fontWeight: FontWeight.w800, color: sound(w.sound).$1),
                    ),
                    TextSpan(text: w.tip),
                  ],
                ),
                style: TextStyle(fontSize: 13, height: 1.35, color: colors.textSecondary),
              ),
            ),
          if (feedback.tip.isNotEmpty) ...[
            const SizedBox(height: 8),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(LucideIcons.lightbulb, size: 16, color: colors.amberText),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    feedback.tip,
                    style: TextStyle(fontSize: 13.5, height: 1.35, fontWeight: FontWeight.w600, color: colors.textPrimary),
                  ),
                ),
              ],
            ),
          ],
          if (feedback.heardIpa.isNotEmpty && feedback.targetIpa.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(l10n.pronunciationSounds(_ipa(feedback.heardIpa), _ipa(feedback.targetIpa)), style: TextStyle(fontSize: 12, color: colors.textMuted)),
          ],
          const SizedBox(height: 6),
          Text(l10n.pronunciationNote, style: TextStyle(fontSize: 11.5, height: 1.35, color: colors.textMuted)),
        ],
      ),
    );
    return Align(
      alignment: centered ? Alignment.center : AlignmentDirectional.centerStart,
      child: panel.withMotion(context, (a) => a.fadeIn(duration: 200.ms).slideY(begin: 0.15, duration: 220.ms)),
    );
  }

  /// IPA without the slashes or brackets a model may already have put around it.
  static String _ipa(String ipa) => ipa.replaceAll(RegExp(r'^[\s/\[]+|[\s/\]]+$'), '');
}

/// The server's verdict on the take: understood, not quite (with what it heard), or unsure. About meaning only.
class _VerdictPanel extends ConsumerWidget {
  const _VerdictPanel({required this.verdict, required this.centered});

  final SpeechVerdict verdict;
  final bool centered;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    final l10n = context.l10n;
    final (IconData icon, Color tone, Color soft, String title, String? body) = switch (verdict.kind) {
      SpeechVerdictKind.understood => (LucideIcons.circleCheck, colors.success, colors.successSoft, l10n.verdictUnderstood, null),
      SpeechVerdictKind.notUnderstood => (LucideIcons.circleAlert, colors.warning, colors.warningSoft, l10n.verdictNotQuite, l10n.verdictNotQuiteHint),
      SpeechVerdictKind.unsure ||
      SpeechVerdictKind.noSpeech => (LucideIcons.circleHelp, colors.info, colors.infoSoft, l10n.verdictUnsure, l10n.verdictUnsureHint),
    };
    final heard = verdict.heard;
    final panel = Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: soft,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: tone.withValues(alpha: 0.6)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 20, color: tone).withMotion(
            context,
            (a) => verdict.understood ? a.scale(begin: const Offset(0.4, 0.4), duration: 380.ms, curve: Curves.elasticOut) : a.shake(hz: 3, duration: 380.ms),
          ),
          const SizedBox(width: 8),
          Flexible(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w800, color: colors.textPrimary),
                ),
                if (heard != null) ...[
                  const SizedBox(height: 2),
                  Text(l10n.verdictHeard(heard), style: TextStyle(fontSize: 13, height: 1.35, color: colors.textSecondary)),
                ],
                if (body != null) ...[const SizedBox(height: 2), Text(body, style: TextStyle(fontSize: 12.5, height: 1.35, color: colors.textMuted))],
              ],
            ),
          ),
        ],
      ),
    );
    return Align(
      alignment: centered ? Alignment.center : AlignmentDirectional.centerStart,
      child: panel.withMotion(context, (a) => a.fadeIn(duration: 200.ms).slideY(begin: 0.15, duration: 220.ms)),
    );
  }
}
