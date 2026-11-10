import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/audio/take_recorder.dart';
import '../../core/platform/recorder.dart';
import '../../core/services/app_state.dart';
import '../../core/services/speech_service.dart';
import '../../l10n/l10n.dart';
import 'learn_widgets.dart';

/// Makes the recorder for one take; null where recording is not available, and the record action is then not shown
/// (CONVENTIONS §8: visible means usable).
final takeRecorderFactoryProvider = Provider<TakeRecorder Function()?>((ref) => canRecordTakes ? createTakeRecorder : null);

enum _Take { idle, starting, recording, recorded, silent, blocked, noMicrophone, failed }

/// Record yourself saying the line, then hear your take next to the reference voice: listen / record / compare
/// (ADR-006). Nothing is judged: no score, no level after the take, only the microphone level while recording, and a
/// take whose loudest moment stays under the server's silence floor is called what it is ("I didn't hear anything").
/// The take stays in memory on this device and is dropped when the line changes or the screen closes.
class RecordTake extends ConsumerStatefulWidget {
  /// The reference voice's locale: the comparison hint names Listen only when the device has that voice.
  final String? voiceLocale;

  /// Centered (the mission's answer card) or aligned to the start (the scene's line card).
  final bool centered;

  const RecordTake({super.key, this.voiceLocale, this.centered = false});

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
    final hasVoice = voiceLocale != null && (ref.watch(voiceAvailableProvider(voiceLocale)).asData?.value ?? false);
    final note = TextStyle(fontSize: 12.5, height: 1.35, color: colors.textMuted);

    final record = AudioChip(icon: LucideIcons.mic, label: l10n.recordYourself, onTap: _state == _Take.starting ? null : _start);
    final tryAgain = AudioChip(icon: LucideIcons.rotateCcw, label: l10n.recordTryAgain, onTap: _start);

    final (List<Widget> chips, String? message) = switch (_state) {
      _Take.idle || _Take.starting => ([record], l10n.recordStaysOnDevice),
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
        ],
        hasVoice ? l10n.recordCompare(l10n.listen, l10n.recordMyVoice) : null,
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
      ],
    );
  }

  static String _clock(Duration d) => '${d.inMinutes}:${(d.inSeconds % 60).toString().padLeft(2, '0')}';
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
