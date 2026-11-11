import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/audio/clip_player.dart';
import '../../core/audio/clip_player_provider.dart';
import '../../core/audio/take_recorder.dart';
import '../../core/backend/account.dart';
import '../../core/backend/curriculum_ids.dart';
import '../../core/backend/server_course.dart';
import '../../core/content/content_models.dart';
import '../../core/layout/celebration.dart';
import '../../core/layout/motion.dart';
import '../../core/services/app_state.dart';
import '../../l10n/l10n.dart';
import '../../navigation/nav.dart';
import '../learn/learn_content.dart';
import '../learn/learn_logic.dart';
import '../learn/learn_providers.dart';
import '../learn/learn_widgets.dart';
import '../learn/record_take.dart';
import '../scenes/animated_scene.dart';
import '../scenes/scene_models.dart';
import 'call_portrait.dart';
import 'call_session.dart';

/// Whether a live call backs the Talk stop of the active course: signed in, and the course's capability snapshot
/// says its characters take calls (visible means usable).
final liveCallCourseProvider = Provider<ServerCourse?>((ref) {
  final courseId = ref.watch(appStateProvider.select((s) => s.activeCourse?.id));
  final course = ref.watch(accountProvider).serverCourse(courseId);
  return course != null && course.liveConversation && ref.watch(apiProvider) != null ? course : null;
});

/// What a call is about: a mission (its goals and scene), or a free conversation with one of the course's characters.
@immutable
class CallTopic {
  const CallTopic({
    required this.title,
    required this.sceneId,
    required this.track,
    this.missionKey,
    this.missionId,
    this.characterId,
    this.characterName,
    this.characterRole,
  });

  /// A mission's call: the server gives it the mission's character, goals and scene.
  factory CallTopic.mission(MissionLearnPlan plan) => CallTopic(
    title: plan.mission.titleIn(plan.source) ?? '',
    sceneId: sceneIdForSituation(plan.mission.situation),
    track: plan.track,
    missionKey: plan.mission.key,
    missionId: missionServerId(plan.mission.chapterKey, plan.mission.key),
  );

  final String title;
  final SceneId sceneId;
  final CourseTrackInfo track;
  final String? missionKey;
  final String? missionId;
  final String? characterId;
  final String? characterName;
  final String? characterRole;

  bool get free => missionId == null;
}

/// One of the course's characters, as the course manifest lists them.
@immutable
class CourseCharacter {
  const CourseCharacter({required this.id, required this.name, required this.role});

  final String id;
  final String name;
  final String role;

  /// The art roster id, when the portrait ships with this build.
  String? get rosterId => rosterIdFor(id);
}

/// The active course's characters (`GET /v1/courses/:trackId/manifest`), when live calls back the course.
final courseCharactersProvider = FutureProvider.autoDispose<List<CourseCharacter>>((ref) async {
  final call = ref.watch(liveCallCourseProvider);
  final api = ref.watch(apiProvider);
  final course = ref.watch(appStateProvider.select((s) => s.activeCourse));
  if (call == null || api == null || course == null) return const [];
  try {
    return [
      for (final c in await api.courseCharacters(course.track.id, course.source))
        if (c['id'] is String && c['name'] is String) CourseCharacter(id: c['id'] as String, name: c['name'] as String, role: '${c['role'] ?? ''}'),
    ];
  } catch (_) {
    return const [];
  }
});

/// The Talk stop: a live phone call with a character of the mission (`/v1/ai/conversation/*`). The learner taps Call
/// (a call costs model calls, so it never starts by itself); the character picks up in the mission's scene, speaks
/// with a lip-synced portrait and subtitles that follow the voice; the learner answers by voice (push to talk) or in
/// writing, can ask for a hint, a repeat, slower speech or a translation, and sees the mission's goals tick off.
/// Hanging up shows the server's evaluation: goals met, at most two corrections, XP. Nothing is invented locally.
class CallScreen extends ConsumerStatefulWidget {
  const CallScreen({super.key, this.missionKey, this.characterId}) : assert(missionKey != null || characterId != null);

  /// The mission the call practises (its Talk stop); null for a free call with [characterId].
  final String? missionKey;

  /// The character called freely (the Speak tab).
  final String? characterId;

  /// A spoken turn stops by itself after this long.
  static const maxTake = Duration(seconds: 20);

  @override
  ConsumerState<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends ConsumerState<CallScreen> {
  CallSession? _session;
  ClipPlayer? _player;
  StreamSubscription<double>? _playerLevels;
  StreamSubscription<double>? _playerProgress;
  final _voiceLevel = ValueNotifier<double>(0);
  final _voiceProgress = ValueNotifier<double>(0);
  String? _speakingId;

  TakeRecorder? _recorder;
  StreamSubscription<double>? _micLevels;
  final _micLevel = ValueNotifier<double>(0);
  Timer? _takeLimit;
  Timer? _takeClock;
  int _takeTenths = 0;
  bool _recording = false;
  bool _bargeIn = false;
  bool _micRefused = false;

  final _text = TextEditingController();
  bool _typing = false;
  bool _showGloss = false;
  final _scroll = ScrollController();
  Timer? _clock;
  Duration _elapsed = Duration.zero;
  bool _credited = false;

  @override
  void dispose() {
    _session?.abandon();
    _session?.removeListener(_onSession);
    _session?.dispose();
    _stopTake();
    _playerLevels?.cancel();
    _playerProgress?.cancel();
    _player?.dispose();
    _clock?.cancel();
    _text.dispose();
    _scroll.dispose();
    _voiceLevel.dispose();
    _voiceProgress.dispose();
    _micLevel.dispose();
    super.dispose();
  }

  bool get _canRecord => ref.read(takeRecorderFactoryProvider) != null && !_micRefused;

  /// Spoken when the device can both record and play the character, and the course's characters speak.
  bool _voiceFor(ServerCourse course) =>
      course.voiceConversation && ref.read(takeRecorderFactoryProvider) != null && ref.read(clipPlayerFactoryProvider) != null;

  void _onSession() {
    if (!mounted) return;
    final session = _session!;
    if (session.phase == CallPhase.active && _clock == null) {
      _clock = Timer.periodic(const Duration(seconds: 1), (_) {
        final since = _session?.connectedAt;
        if (mounted && since != null && _session?.phase == CallPhase.active) setState(() => _elapsed = DateTime.now().difference(since));
      });
    }
    if (session.phase == CallPhase.ended || session.phase == CallPhase.failed) {
      _clock?.cancel();
      final missionKey = widget.missionKey;
      if (session.phase == CallPhase.ended && !_credited && session.learnerTurns > 0 && missionKey != null) {
        _credited = true;
        ref.read(appStateProvider.notifier).completeStop(missionKey, PathStop.talk);
      }
    }
    setState(() {});
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
    });
  }

  Future<void> _call(CallTopic topic, ServerCourse course) async {
    final api = ref.read(apiProvider);
    if (api == null) return;
    final voice = _voiceFor(course);
    if (voice && _player == null) {
      final player = ref.read(clipPlayerFactoryProvider)!();
      _player = player;
      _playerLevels = player.levels.listen((level) => _voiceLevel.value = level);
      _playerProgress = player.progress.listen((p) => _voiceProgress.value = p);
    }
    // Inside the tap: browsers start audio output only from a gesture.
    _player?.prime();
    final previous = _session;
    previous?.removeListener(_onSession);
    previous?.dispose();
    final session = CallSession(api: api, course: course, missionId: topic.missionId, characterId: topic.characterId, voice: voice)..addListener(_onSession);
    _clock?.cancel();
    _clock = null;
    setState(() {
      _session = session;
      _elapsed = Duration.zero;
      _typing = !voice;
      _credited = false;
    });
    final opening = await session.start();
    if (opening != null && mounted) unawaited(_play(opening));
  }

  Future<void> _play(CallLine line) async {
    final url = line.audioUrl;
    final player = _player;
    if (url == null || player == null || !mounted) return;
    _voiceProgress.value = 0;
    setState(() => _speakingId = line.id);
    await player.play(url);
    if (mounted && _speakingId == line.id) setState(() => _speakingId = null);
  }

  void _stopVoice() {
    _player?.stop();
    if (_speakingId != null) setState(() => _speakingId = null);
  }

  Future<void> _startTake() async {
    final create = ref.read(takeRecorderFactoryProvider);
    final session = _session;
    if (create == null || session == null || _recording || session.thinking) return;
    _bargeIn = _speakingId != null;
    _stopVoice();
    session.clearNotice();
    final recorder = create();
    _recorder = recorder;
    setState(() {
      _recording = true;
      _takeTenths = 0;
    });
    final opened = await _open(recorder);
    if (!mounted || _recorder != recorder) {
      unawaited(recorder.dispose());
      return;
    }
    if (!opened) {
      _stopTake();
      // No microphone (refused, missing or busy): the conversation goes on in writing.
      setState(() {
        _micRefused = true;
        _typing = true;
      });
      return;
    }
    _micLevels = recorder.levels.listen((dbfs) => _micLevel.value = ((dbfs + 60) / 50).clamp(0.0, 1.0));
    _takeClock = Timer.periodic(const Duration(milliseconds: 100), (_) {
      if (mounted) setState(() => _takeTenths++);
    });
    _takeLimit = Timer(CallScreen.maxTake, _sendTake);
  }

  /// Starts [recorder]: whether it records (a helper returning the outcome: see `RecordTake._open`).
  static Future<bool> _open(TakeRecorder recorder) async {
    try {
      await recorder.start();
      return true;
    } catch (_) {
      return false;
    }
  }

  static Future<RecordedTake?> _close(TakeRecorder recorder) async {
    try {
      return await recorder.stop();
    } catch (_) {
      return null;
    }
  }

  /// Stops the timers and releases the microphone, dropping the take.
  void _stopTake() {
    _takeLimit?.cancel();
    _takeClock?.cancel();
    unawaited(_micLevels?.cancel());
    _micLevels = null;
    _micLevel.value = 0;
    final recorder = _recorder;
    _recorder = null;
    if (recorder != null) unawaited(recorder.dispose());
    if (_recording && mounted) setState(() => _recording = false);
    _recording = false;
  }

  Future<void> _sendTake() async {
    final recorder = _recorder;
    final session = _session;
    if (recorder == null || session == null || !_recording) return;
    _recorder = null;
    _takeLimit?.cancel();
    _takeClock?.cancel();
    unawaited(_micLevels?.cancel());
    _micLevels = null;
    _micLevel.value = 0;
    final take = await _close(recorder);
    unawaited(recorder.dispose());
    if (!mounted) {
      take?.dispose();
      return;
    }
    setState(() => _recording = false);
    if (take == null || take.duration < RecordTake.minTake) {
      take?.dispose();
      return;
    }
    if (isSilentTake(take.peakLevelDb)) {
      take.dispose();
      session.notice = CallNotice.noSpeech;
      setState(() {});
      return;
    }
    final reply = await session.sendTake(take, bargeIn: _bargeIn);
    take.dispose();
    if (reply != null && mounted) unawaited(_play(reply));
  }

  Future<void> _sendText() async {
    final session = _session;
    final text = _text.text.trim();
    if (session == null || text.isEmpty || session.thinking) return;
    _stopVoice();
    _text.clear();
    final reply = await session.sendText(text);
    if (reply != null && mounted) unawaited(_play(reply));
  }

  Future<void> _command(String command) async {
    final session = _session;
    if (session == null || session.thinking || _recording) return;
    _stopVoice();
    final reply = await session.sendCommand(command);
    if (reply != null && mounted) unawaited(_play(reply));
  }

  /// Repeat: the last line again from this device (free); asked of the character when there is no audio.
  void _repeat() {
    final last = _session?.lastCharacterLine;
    if (last?.audioUrl != null && _player != null) {
      unawaited(_play(last!));
    } else {
      unawaited(_command('repeat'));
    }
  }

  /// Translate: the server's gloss, when it wrote one; otherwise the character is asked.
  void _translate() {
    final hasGloss = _session?.lines.any((l) => !l.fromLearner && l.gloss != null) ?? false;
    if (hasGloss) {
      setState(() => _showGloss = !_showGloss);
    } else {
      unawaited(_command('translate'));
    }
  }

  Future<void> _hangUp() async {
    _stopTake();
    _stopVoice();
    await _session?.hangUp();
  }

  /// The mission's call, or the free call with the character (its name and role from the course's manifest).
  CallTopic? _topic() {
    final missionKey = widget.missionKey;
    if (missionKey != null) {
      final plan = ref.watch(learnPlanProvider(missionKey));
      return plan == null ? null : CallTopic.mission(plan);
    }
    final appState = ref.watch(appStateProvider);
    final course = appState.activeCourse;
    if (course == null) return null;
    final who = ref.watch(courseCharactersProvider).asData?.value.where((c) => c.id == widget.characterId).firstOrNull;
    // A free call happens where the learner's next mission does.
    final next = appState.nextMission(course) ?? (course.missions.isEmpty ? null : course.missions.first);
    return CallTopic(
      title: who?.name ?? '',
      sceneId: sceneIdForSituation(next?.situation ?? 'street'),
      track: course.track,
      characterId: widget.characterId,
      characterName: who?.name,
      characterRole: who?.role,
    );
  }

  @override
  Widget build(BuildContext context) {
    final topic = _topic();
    final course = ref.watch(liveCallCourseProvider);
    if (topic == null) return const MissionUnavailable();
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    final session = _session;
    final phase = session?.phase ?? CallPhase.idle;

    return PopScope(
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) _session?.abandon();
      },
      child: Scaffold(
        backgroundColor: colors.background,
        body: SafeArea(
          child: switch (phase) {
            CallPhase.idle => _IntroView(topic: topic, course: course, onCall: course == null ? null : () => _call(topic, course)),
            CallPhase.connecting => _RingingView(topic: topic),
            CallPhase.failed => _FailedView(failure: session!.failure, onRetry: course == null ? null : () => _call(topic, course)),
            CallPhase.ending => const _EndingView(),
            CallPhase.ended => _SummaryView(
              session: session!,
              elapsed: _elapsed,
              voice: session.voice,
              onAgain: course == null ? null : () => _call(topic, course),
              onBack: () => context.popOrHome(),
            ),
            CallPhase.active => _activeView(topic, session!),
          },
        ),
      ),
    );
  }

  Widget _activeView(CallTopic topic, CallSession session) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final character = session.character!;
    final name = character.name;
    final sceneId = topic.sceneId;
    final speaking = _speakingId != null;
    final last = session.lastCharacterLine;
    final expression = _recording ? 'listening' : (session.thinking ? 'listening' : (last?.expression ?? 'greeting'));
    final status = speaking
        ? l10n.callSpeaking(name)
        : session.thinking
        ? l10n.callThinking(name)
        : _recording
        ? l10n.callListening
        : session.characterEnded
        ? l10n.callSaidGoodbye(name)
        : (session.voice && !_micRefused ? l10n.callYourTurnVoice : l10n.callYourTurnText);
    final notice = switch (session.notice) {
      CallNotice.noSpeech => l10n.callNoSpeech,
      CallNotice.turnFailed => l10n.callTurnFailed,
      null => null,
    };
    final clock = '${_elapsed.inMinutes}:${(_elapsed.inSeconds % 60).toString().padLeft(2, '0')}';

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(8, 4, 12, 0),
          child: Row(
            children: [
              IconButton(
                icon: Icon(LucideIcons.chevronDown, color: colors.textSecondary),
                tooltip: l10n.close,
                onPressed: () => context.popOrHome(),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: colors.textPrimary),
                    ),
                    Text(
                      character.role.isEmpty ? clock : '${character.role} · $clock',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 12.5, color: colors.textMuted, fontFeatures: const [FontFeature.tabularFigures()]),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        if (session.objectives.isNotEmpty) _GoalsStrip(objectives: session.objectives),
        Expanded(
          flex: 5,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 6, 16, 0),
            child: LayoutBuilder(
              builder: (context, box) {
                final portrait = (box.maxHeight * 0.62).clamp(96.0, 220.0);
                return AnimatedSceneWidget(
                  sceneId: sceneId,
                  title: sceneTitle(l10n, sceneId),
                  height: box.maxHeight,
                  showTimeToggle: false,
                  child: Stack(
                    alignment: Alignment.center,
                    children: [
                      CallPortrait(
                        rosterId: rosterIdFor(character.id),
                        name: name,
                        expression: expression,
                        speaking: speaking,
                        level: _voiceLevel,
                        ringColor: accent.primary,
                        size: portrait,
                      ),
                      if (last != null)
                        Positioned(
                          top: 8,
                          right: 24,
                          child: _Reaction(key: ValueKey(last.id), expression: last.expression),
                        ),
                    ],
                  ),
                );
              },
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          child: Semantics(
            liveRegion: true,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (session.thinking) ...[_TypingDots(color: accent.primaryText), const SizedBox(width: 8)],
                Flexible(
                  child: Text(
                    notice ?? status,
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: notice != null ? colors.warning : colors.textSecondary),
                  ),
                ),
              ],
            ),
          ),
        ),
        Expanded(
          flex: 4,
          // Older lines fade out at the top as the conversation scrolls up.
          child: ShaderMask(
            blendMode: BlendMode.dstIn,
            shaderCallback: (rect) => const LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Color(0x00000000), Color(0xFF000000)],
              stops: [0, 0.08],
            ).createShader(rect),
            child: ListView(
              controller: _scroll,
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
              children: [
                for (final line in session.lines)
                  line.fromLearner
                      ? _LearnerBubble(key: ValueKey(line.id), line: line)
                      : _CharacterBubble(
                          key: ValueKey(line.id),
                          line: line,
                          track: topic.track,
                          speaking: _speakingId == line.id,
                          progress: _voiceProgress,
                          // Help (a hint, a translation, an example) is written in the learner's language: always shown.
                          showGloss: _showGloss || line.respondsTo != null,
                          onReplay: line.audioUrl == null || _player == null ? null : () => _play(line),
                        ),
              ],
            ),
          ),
        ),
        _controls(session),
      ],
    );
  }

  Widget _controls(CallSession session) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final busy = session.thinking;
    final canSpeak = session.voice && _canRecord;
    final help = [
      (LucideIcons.lightbulb, l10n.callHint, () => _command('hint')),
      (LucideIcons.rotateCcw, l10n.callRepeat, _repeat),
      (LucideIcons.snail, l10n.callSlower, () => _command('slower')),
      (LucideIcons.languages, l10n.callTranslate, _translate),
    ];
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final (icon, label, onTap) in help)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: AudioChip(icon: icon, label: label, onTap: busy || _recording ? null : onTap),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          if (_typing || !canSpeak)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _text,
                      enabled: !busy,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _sendText(),
                      style: TextStyle(fontSize: 16, color: colors.textPrimary),
                      decoration: InputDecoration(
                        hintText: l10n.callTypeHint,
                        isDense: true,
                        filled: true,
                        fillColor: colors.surface,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(14),
                          borderSide: BorderSide(color: colors.border),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    onPressed: busy ? null : _sendText,
                    tooltip: l10n.callSend,
                    style: IconButton.styleFrom(backgroundColor: accent.primary, foregroundColor: accent.onPrimary, minimumSize: const Size(48, 48)),
                    icon: const Icon(LucideIcons.send, size: 20),
                  ),
                ],
              ),
            ),
          Row(
            children: [
              SizedBox(
                width: 64,
                child: canSpeak
                    ? IconButton(
                        tooltip: _recording ? l10n.callCancelTake : l10n.callType,
                        onPressed: _recording ? _stopTake : () => setState(() => _typing = !_typing),
                        icon: Icon(_recording ? LucideIcons.x : LucideIcons.keyboard, color: colors.textSecondary),
                      )
                    : null,
              ),
              Expanded(
                child: Center(
                  child: canSpeak
                      ? _MicButton(
                          recording: _recording,
                          enabled: !busy,
                          level: _micLevel,
                          clock: '0:${(_takeTenths ~/ 10).toString().padLeft(2, '0')}',
                          onTap: _recording ? _sendTake : _startTake,
                        )
                      : const SizedBox(height: 72),
                ),
              ),
              SizedBox(
                width: 64,
                child:
                    Semantics(
                      button: true,
                      label: session.voice ? l10n.callHangUp : l10n.callEndChat,
                      excludeSemantics: true,
                      child: IconButton.filled(
                        onPressed: _hangUp,
                        style: IconButton.styleFrom(backgroundColor: const Color(0xFFE5484D), foregroundColor: Colors.white, minimumSize: const Size(56, 56)),
                        icon: const Icon(LucideIcons.phoneOff, size: 24),
                      ),
                    ).withMotion(
                      context,
                      (a) => session.characterEnded
                          ? a.shimmer(duration: 1400.ms, color: Colors.white.withValues(alpha: 0.5)).then().shake(hz: 2, duration: 500.ms)
                          : a,
                    ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Before the call: what it is, what it costs the learner (nothing; it uses the AI), and the Call button.
class _IntroView extends ConsumerWidget {
  const _IntroView({required this.topic, required this.course, required this.onCall});

  final CallTopic topic;
  final ServerCourse? course;
  final VoidCallback? onCall;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final keeps = ref.watch(accountProvider).lastReport?.keepsRecordings ?? false;
    final voice = course != null && course!.voiceConversation && ref.watch(takeRecorderFactoryProvider) != null && ref.watch(clipPlayerFactoryProvider) != null;
    final sceneId = topic.sceneId;
    final roster = topic.characterId == null ? null : rosterIdFor(topic.characterId!);
    return Column(
      children: [
        Align(
          alignment: Alignment.centerLeft,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(8, 4, 8, 0),
            child: IconButton(
              icon: Icon(LucideIcons.x, color: colors.textSecondary),
              tooltip: l10n.close,
              onPressed: () => context.popOrHome(),
            ),
          ),
        ),
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Column(
              children: [
                AnimatedSceneWidget(
                  sceneId: sceneId,
                  title: sceneTitle(l10n, sceneId),
                  height: 170,
                  showTimeToggle: false,
                  child: Center(
                    child:
                        (roster != null
                                ? SvgPicture.asset(portraitAsset(roster, 'greeting'), width: 120, height: 120, excludeFromSemantics: true)
                                : Container(
                                    width: 72,
                                    height: 72,
                                    decoration: BoxDecoration(shape: BoxShape.circle, color: accent.primary),
                                    child: Icon(voice ? LucideIcons.phoneCall : LucideIcons.messageCircle, color: accent.onPrimary, size: 32),
                                  ))
                            .withMotion(context, (a) => a.scale(begin: const Offset(0.8, 0.8), duration: 420.ms, curve: Curves.easeOutBack)),
                  ),
                ),
                const SizedBox(height: 20),
                Semantics(
                  header: true,
                  child: Text(
                    topic.free ? l10n.callFreeTitle(topic.characterName ?? '') : l10n.callIntroTitle,
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, height: 1.2, color: colors.textPrimary),
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  topic.free ? (topic.characterRole ?? '') : topic.title,
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: accent.primaryText),
                ),
                const SizedBox(height: 12),
                Text(
                  topic.free ? (voice ? l10n.callFreeBody : l10n.callFreeBodyText) : (voice ? l10n.callIntroBody : l10n.callIntroBodyText),
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 15, height: 1.45, color: colors.textSecondary),
                ),
                const SizedBox(height: 10),
                Text(
                  keeps ? l10n.callIntroNoteKept : l10n.callIntroNote,
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 12.5, height: 1.35, color: colors.textMuted),
                ),
              ],
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: LearnPrimaryButton(
            label: voice ? l10n.callStart : l10n.callStartText,
            icon: voice ? LucideIcons.phone : LucideIcons.messageCircle,
            onPressed: onCall,
          ),
        ),
      ],
    );
  }
}

/// The phone rings: rings pulse out from the call icon while the character picks up.
class _RingingView extends ConsumerWidget {
  const _RingingView({required this.topic});

  final CallTopic topic;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    Widget ring(int i) =>
        Container(
          width: 120,
          height: 120,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(color: accent.primary.withValues(alpha: 0.6), width: 2),
          ),
        ).withMotion(
          context,
          (a) => a
              .animate(onPlay: (c) => c.repeat())
              .scale(begin: const Offset(1, 1), end: const Offset(2.1, 2.1), delay: (i * 500).ms, duration: 1500.ms)
              .fadeOut(delay: (i * 500).ms, duration: 1500.ms),
        );
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        SizedBox(
          width: 260,
          height: 260,
          child: Stack(
            alignment: Alignment.center,
            children: [
              for (var i = 0; i < 3; i++) ring(i),
              Container(
                width: 96,
                height: 96,
                decoration: BoxDecoration(shape: BoxShape.circle, color: accent.primary),
                child: Icon(LucideIcons.phoneCall, color: accent.onPrimary, size: 40),
              ).withMotion(context, (a) => a.animate(onPlay: (c) => c.repeat()).shake(hz: 4, rotation: 0.08, duration: 700.ms).then(delay: 700.ms)),
            ],
          ),
        ),
        const SizedBox(height: 16),
        Semantics(
          liveRegion: true,
          child: Text(
            l10n.callCalling,
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: colors.textPrimary),
          ),
        ),
        const SizedBox(height: 6),
        Text(topic.title, style: TextStyle(fontSize: 14, color: colors.textSecondary)),
      ],
    );
  }
}

class _FailedView extends ConsumerWidget {
  const _FailedView({required this.failure, required this.onRetry});

  final CallFailure? failure;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    final l10n = context.l10n;
    final message = switch (failure) {
      CallFailure.unavailable => l10n.callFailedUnavailable,
      CallFailure.ended => l10n.callFailedEnded,
      _ => l10n.callFailedNetwork,
    };
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(LucideIcons.phoneOff, size: 44, color: colors.textMuted),
          const SizedBox(height: 16),
          Semantics(
            liveRegion: true,
            child: Text(
              message,
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 16, height: 1.4, color: colors.textPrimary),
            ),
          ),
          const SizedBox(height: 24),
          if (failure != CallFailure.unavailable && onRetry != null) LearnPrimaryButton(label: l10n.callTryAgain, icon: LucideIcons.phone, onPressed: onRetry),
          TextButton(onPressed: () => context.popOrHome(), child: Text(l10n.missionBackToPath)),
        ],
      ),
    );
  }
}

class _EndingView extends ConsumerWidget {
  const _EndingView();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(color: colors.textMuted),
            const SizedBox(height: 16),
            Semantics(
              liveRegion: true,
              child: Text(
                context.l10n.callEnding,
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 15, color: colors.textSecondary),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// After hanging up: the server's evaluation, never more than it said.
class _SummaryView extends ConsumerWidget {
  const _SummaryView({required this.session, required this.elapsed, required this.voice, required this.onAgain, required this.onBack});

  final CallSession session;
  final Duration elapsed;
  final bool voice;
  final VoidCallback? onAgain;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final summary = session.summary;
    final met = summary?.objectivesMet.toSet() ?? const <String>{};
    final clock = '${elapsed.inMinutes}:${(elapsed.inSeconds % 60).toString().padLeft(2, '0')}';
    final card = BoxDecoration(
      color: colors.surface,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: colors.border),
    );
    var stagger = 0;
    Widget enter(Widget child) {
      final delay = 90 * stagger++;
      return child.withMotion(context, (a) => a.fadeIn(delay: delay.ms, duration: 260.ms).slideY(begin: 0.12, delay: delay.ms, duration: 260.ms));
    }

    final celebrate = summary != null && (summary.objectivesMet.isNotEmpty || summary.xp > 0);
    final view = Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 24, 20, 12),
            children: [
              enter(
                Column(
                  children: [
                    Container(
                      width: 64,
                      height: 64,
                      decoration: BoxDecoration(shape: BoxShape.circle, color: colors.surfaceMuted),
                      child: Icon(LucideIcons.phoneOff, color: colors.textSecondary),
                    ),
                    const SizedBox(height: 12),
                    Semantics(
                      header: true,
                      child: Text(
                        '${voice ? l10n.callEndedTitle : l10n.callChatEndedTitle} · $clock',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: colors.textPrimary),
                      ),
                    ),
                    if (summary != null && summary.xp > 0) ...[
                      const SizedBox(height: 6),
                      CountUp(
                        value: summary.xp,
                        builder: (context, xp) => Text(
                          l10n.xpGain(xp),
                          style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: accent.primaryText),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 18),
              if (session.objectives.isNotEmpty)
                enter(
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: card,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          l10n.callGoalsMet(session.objectives.where((o) => met.contains(o.id)).length, session.objectives.length),
                          style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: colors.textPrimary),
                        ),
                        const SizedBox(height: 8),
                        for (final o in session.objectives)
                          if (o.description.trim().isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 3),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Icon(
                                    met.contains(o.id) ? LucideIcons.circleCheck : LucideIcons.circle,
                                    size: 18,
                                    color: met.contains(o.id) ? colors.success : colors.textMuted,
                                  ),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(o.description, style: TextStyle(fontSize: 14, height: 1.35, color: colors.textSecondary)),
                                  ),
                                ],
                              ),
                            ),
                      ],
                    ),
                  ),
                ),
              if (summary != null && summary.summary.isNotEmpty) ...[
                const SizedBox(height: 12),
                enter(
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: card,
                    child: Text(summary.summary, style: TextStyle(fontSize: 14.5, height: 1.45, color: colors.textPrimary)),
                  ),
                ),
              ],
              if (summary != null && summary.corrections.isNotEmpty) ...[
                const SizedBox(height: 16),
                enter(
                  Text(
                    l10n.callNextTime,
                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, letterSpacing: 0.6, color: accent.primaryText),
                  ),
                ),
                const SizedBox(height: 8),
                for (final c in summary.corrections)
                  enter(
                    Container(
                      margin: const EdgeInsets.only(bottom: 10),
                      padding: const EdgeInsets.all(14),
                      decoration: card,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (c.said.isNotEmpty) Text(l10n.callYouSaid(c.said), style: TextStyle(fontSize: 13.5, color: colors.textMuted)),
                          const SizedBox(height: 4),
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(LucideIcons.sparkles, size: 16, color: colors.success),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  c.better,
                                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: colors.textPrimary),
                                ),
                              ),
                            ],
                          ),
                          if (c.why.isNotEmpty) ...[
                            const SizedBox(height: 4),
                            Text(c.why, style: TextStyle(fontSize: 13.5, height: 1.4, color: colors.textSecondary)),
                          ],
                        ],
                      ),
                    ),
                  ),
              ],
              if (summary == null || !summary.evaluated) ...[
                const SizedBox(height: 12),
                Text(
                  l10n.callNotEvaluated,
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 13, color: colors.textMuted),
                ),
              ],
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
          child: Column(
            children: [
              if (onAgain != null) LearnPrimaryButton(label: l10n.callAgain, icon: LucideIcons.phone, onPressed: onAgain),
              TextButton(
                onPressed: onBack,
                child: Text(
                  l10n.missionBackToPath,
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: accent.primaryText),
                ),
              ),
            ],
          ),
        ),
      ],
    );
    if (!celebrate) return view;
    return Stack(
      children: [
        view,
        Positioned.fill(
          child: ConfettiBurst(
            colors: [accent.primary, colors.celebrationA, colors.celebrationB, colors.success, colors.amber],
            origin: const Alignment(0, -0.6),
          ),
        ),
      ],
    );
  }
}

/// The mission's goals for the call, ticking off as the conversation meets them.
class _GoalsStrip extends ConsumerWidget {
  const _GoalsStrip({required this.objectives});

  final List<CallObjective> objectives;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    final l10n = context.l10n;
    // Goals the server cannot word in the learner's language (no localized description): their progress only, as
    // dots, never invented text.
    if (objectives.any((o) => o.description.trim().isEmpty)) {
      final met = objectives.where((o) => o.done || o.tentative).length;
      return Semantics(
        label: l10n.callGoalsMet(met, objectives.length),
        excludeSemantics: true,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 2),
          child: Row(
            children: [
              Text(
                l10n.callGoals,
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, letterSpacing: 0.6, color: colors.textMuted),
              ),
              const SizedBox(width: 10),
              for (final o in objectives)
                AnimatedContainer(
                  duration: const Duration(milliseconds: 350),
                  curve: Curves.easeOutBack,
                  width: o.done || o.tentative ? 12 : 10,
                  height: o.done || o.tentative ? 12 : 10,
                  margin: const EdgeInsets.only(right: 6),
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: o.done ? colors.success : (o.tentative ? colors.success.withValues(alpha: 0.45) : Colors.transparent),
                    border: Border.all(color: o.done || o.tentative ? colors.success : colors.borderStrong, width: 1.5),
                  ),
                ),
              const SizedBox(width: 2),
              Text(
                '$met/${objectives.length}',
                style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: colors.textSecondary, fontFeatures: const [FontFeature.tabularFigures()]),
              ),
            ],
          ),
        ),
      );
    }
    return SizedBox(
      height: 38,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        children: [
          Center(
            child: Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Text(
                l10n.callGoals,
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, letterSpacing: 0.6, color: colors.textMuted),
              ),
            ),
          ),
          for (final o in objectives)
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: Semantics(
                label: o.done ? l10n.callGoalDone(o.description) : (o.tentative ? l10n.callGoalProbably(o.description) : l10n.callGoalNotYet(o.description)),
                excludeSemantics: true,
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 300),
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  margin: const EdgeInsets.symmetric(vertical: 3),
                  decoration: BoxDecoration(
                    color: o.done || o.tentative ? colors.successSoft : colors.surface,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: o.done ? colors.success : (o.tentative ? colors.success.withValues(alpha: 0.5) : colors.border)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      AnimatedSwitcher(
                        duration: context.reduceMotion ? Duration.zero : const Duration(milliseconds: 350),
                        transitionBuilder: (child, a) => ScaleTransition(
                          scale: CurvedAnimation(parent: a, curve: Curves.elasticOut),
                          child: child,
                        ),
                        child: Icon(
                          o.done ? LucideIcons.circleCheck : (o.tentative ? LucideIcons.circleDashed : LucideIcons.circle),
                          key: ValueKey((o.done, o.tentative)),
                          size: 15,
                          color: o.done || o.tentative ? colors.success : colors.textMuted,
                        ),
                      ),
                      const SizedBox(width: 6),
                      ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 220),
                        child: Text(
                          o.description,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 12.5, color: colors.textSecondary),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// A character's line: the words, highlighted as the voice reaches them; the transliteration; the translation when
/// asked; a replay button.
class _CharacterBubble extends ConsumerWidget {
  const _CharacterBubble({
    super.key,
    required this.line,
    required this.track,
    required this.speaking,
    required this.progress,
    required this.showGloss,
    required this.onReplay,
  });

  final CallLine line;
  final CourseTrackInfo track;
  final bool speaking;
  final ValueListenable<double> progress;
  final bool showGloss;
  final VoidCallback? onReplay;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final still = context.reduceMotion;
    final style = TextStyle(fontSize: 18, height: 1.35, fontWeight: FontWeight.w600, color: colors.textPrimary);
    final words = speaking && !still
        ? ValueListenableBuilder<double>(
            valueListenable: progress,
            builder: (context, p, _) {
              // The voice and the words advance together (by characters: there are no word timings).
              final cut = _wordEnd(line.text!, (p * line.text!.length).round());
              return Text.rich(
                TextSpan(
                  children: [
                    TextSpan(text: line.text!.substring(0, cut)),
                    TextSpan(
                      text: line.text!.substring(cut),
                      style: TextStyle(color: colors.textMuted),
                    ),
                  ],
                ),
                style: style,
              );
            },
          )
        : Text(line.text!, style: style);
    final bubble = Container(
      margin: const EdgeInsets.only(bottom: 8, right: 40),
      padding: const EdgeInsets.fromLTRB(14, 10, 6, 10),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: const BorderRadius.only(
          topLeft: Radius.circular(4),
          topRight: Radius.circular(18),
          bottomLeft: Radius.circular(18),
          bottomRight: Radius.circular(18),
        ),
        border: Border.all(color: speaking ? accent.primary : colors.border, width: speaking ? 1.5 : 1),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Semantics(
              localeForSubtree: contentLanguageOf(track),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  words,
                  if (line.transliteration != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      line.transliteration!,
                      style: TextStyle(fontSize: 13.5, fontStyle: FontStyle.italic, color: colors.textSecondary),
                    ),
                  ],
                  if (showGloss && line.gloss != null) ...[
                    const SizedBox(height: 4),
                    Text(line.gloss!, style: TextStyle(fontSize: 13.5, color: accent.primaryText)),
                  ],
                ],
              ),
            ),
          ),
          if (onReplay != null)
            IconButton(
              tooltip: l10n.callReplayLine,
              onPressed: onReplay,
              icon: Icon(LucideIcons.volume2, size: 18, color: colors.textMuted),
            ),
        ],
      ),
    );
    return Align(
      alignment: AlignmentDirectional.centerStart,
      child: bubble.withMotion(context, (a) => a.fadeIn(duration: 240.ms).slideX(begin: -0.06, duration: 260.ms, curve: Curves.easeOut)),
    );
  }

  /// The end of the word at [index], so the highlight never cuts a word in two.
  static int _wordEnd(String text, int index) {
    if (index <= 0) return 0;
    if (index >= text.length) return text.length;
    final space = text.indexOf(' ', index);
    return space < 0 ? text.length : space;
  }
}

/// The learner's line, as the server heard it ("…" while it is being heard).
class _LearnerBubble extends ConsumerWidget {
  const _LearnerBubble({super.key, required this.line});

  final CallLine line;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final accent = appState.accent;
    final l10n = context.l10n;
    final bubble = Container(
      margin: const EdgeInsets.only(bottom: 8, left: 48),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: accent.primary,
        borderRadius: const BorderRadius.only(
          topLeft: Radius.circular(18),
          topRight: Radius.circular(4),
          bottomLeft: Radius.circular(18),
          bottomRight: Radius.circular(18),
        ),
      ),
      child: line.pending
          ? Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(LucideIcons.mic, size: 15, color: accent.onPrimary),
                const SizedBox(width: 6),
                Text(l10n.callHeardYou, style: TextStyle(fontSize: 14, color: accent.onPrimary)),
              ],
            )
          : Semantics(
              label: '${l10n.callYou}: ${line.text}',
              excludeSemantics: true,
              child: Text(
                line.text ?? '',
                style: TextStyle(fontSize: 16, height: 1.35, fontWeight: FontWeight.w600, color: accent.onPrimary),
              ),
            ),
    );
    return Align(
      alignment: AlignmentDirectional.centerEnd,
      child: bubble.withMotion(context, (a) => a.fadeIn(duration: 200.ms).slideX(begin: 0.06, duration: 220.ms, curve: Curves.easeOut)),
    );
  }
}

/// The push-to-talk button: tap to talk, tap again to send; the rings follow the microphone's level.
class _MicButton extends ConsumerWidget {
  const _MicButton({required this.recording, required this.enabled, required this.level, required this.clock, required this.onTap});

  final bool recording;
  final bool enabled;
  final ValueListenable<double> level;
  final String clock;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final color = recording ? colors.error : accent.primary;
    return Semantics(
      button: true,
      enabled: enabled,
      label: recording ? l10n.callSend : l10n.callTalk,
      excludeSemantics: true,
      child: GestureDetector(
        onTap: enabled ? onTap : null,
        child: ValueListenableBuilder<double>(
          valueListenable: level,
          builder: (context, l, child) {
            final swell = recording && !context.reduceMotion ? l : 0.0;
            return SizedBox(
              width: 120,
              height: 76,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  Container(
                    width: 64 + 26 * swell,
                    height: 64 + 26 * swell,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: color.withValues(alpha: 0.18 + 0.2 * swell),
                    ),
                  ),
                  child!,
                ],
              ),
            );
          },
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: enabled ? color : colors.border,
              boxShadow: enabled ? [BoxShadow(color: color.withValues(alpha: 0.45), blurRadius: 14, spreadRadius: 1)] : null,
            ),
            child: recording
                ? Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(LucideIcons.send, color: Colors.white, size: 22),
                      Text(
                        clock,
                        style: const TextStyle(fontSize: 10.5, color: Colors.white, fontFeatures: [FontFeature.tabularFigures()]),
                      ),
                    ],
                  )
                : Icon(LucideIcons.mic, color: enabled ? accent.onPrimary : colors.textMuted, size: 28),
          ),
        ),
      ),
    );
  }
}

/// Three dots bouncing: the character is answering.
class _TypingDots extends StatelessWidget {
  const _TypingDots({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 0; i < 3; i++)
          Container(
            width: 6,
            height: 6,
            margin: const EdgeInsets.symmetric(horizontal: 2),
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ).withMotion(
            context,
            (a) => a
                .animate(onPlay: (c) => c.repeat())
                .moveY(begin: 0, end: -4, delay: (i * 140).ms, duration: 300.ms, curve: Curves.easeOut)
                .then()
                .moveY(begin: -4, end: 0, duration: 300.ms),
          ),
      ],
    );
  }
}

/// A small reaction that floats up beside the portrait when the character greets, is pleased, surprised or unsure.
class _Reaction extends ConsumerWidget {
  const _Reaction({super.key, required this.expression});

  final String expression;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final icon = switch (expression) {
      'greeting' => LucideIcons.hand,
      'friendly_success' => LucideIcons.sparkles,
      'surprise' => LucideIcons.zap,
      'confusion' => LucideIcons.circleHelp,
      'follow_up_question' => LucideIcons.messageCircleQuestion,
      _ => null,
    };
    if (icon == null || context.reduceMotion) return const SizedBox.shrink();
    return ExcludeSemantics(
      child:
          Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: colors.elevated,
                  shape: BoxShape.circle,
                  boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.25), blurRadius: 8)],
                ),
                child: Icon(icon, size: 20, color: appState.accent.primaryText),
              )
              .animate()
              .fadeIn(duration: 200.ms)
              .scale(begin: const Offset(0.5, 0.5), curve: Curves.easeOutBack, duration: 320.ms)
              .moveY(begin: 6, end: -10, duration: 1400.ms)
              .then(delay: 600.ms)
              .fadeOut(duration: 500.ms),
    );
  }
}
