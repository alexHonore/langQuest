import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/backend/narrator.dart';
import '../../core/backend/server_voice.dart';
import '../../core/layout/celebration.dart';
import '../../core/layout/motion.dart';
import '../../core/services/app_state.dart';
import '../../core/services/learner_store.dart';
import '../../core/services/speech_service.dart';
import '../../l10n/l10n.dart';
import '../../navigation/nav.dart';
import '../learn/learn_content.dart';
import '../learn/learn_providers.dart';
import '../learn/learn_widgets.dart';
import '../scenes/animated_scene.dart';
import 'audio_lesson.dart';
import 'audio_lesson_player.dart';

/// The audio lessons a learner has listened to the end, per course (on this device).
class AudioListened extends Notifier<Map<String, Set<String>>> {
  static const key = 'langquest.audio.listened.v1';

  @override
  Map<String, Set<String>> build() {
    try {
      final raw = jsonDecode(ref.read(learnerStoreProvider).prefs.getString(key) ?? '{}');
      if (raw is Map) {
        return {
          for (final e in raw.entries) '${e.key}': {...(e.value as List).map((v) => '$v')},
        };
      }
    } catch (_) {}
    return {};
  }

  void markListened(String courseId, String missionKey) {
    if (state[courseId]?.contains(missionKey) ?? false) return;
    state = {
      ...state,
      courseId: {...?state[courseId], missionKey},
    };
    unawaited(ref.read(learnerStoreProvider).prefs.setString(key, jsonEncode({for (final e in state.entries) e.key: e.value.toList()..sort()})));
  }

  /// Everything, for "Reset all progress".
  void clear() {
    state = {};
    unawaited(ref.read(learnerStoreProvider).prefs.remove(key));
  }
}

final audioListenedProvider = NotifierProvider<AudioListened, Map<String, Set<String>>>(AudioListened.new);

/// Whether the active course's lessons can be heard here (a device voice for it, or the server's AI voice): the Audio
/// tab exists only then (visible means usable).
final audioLessonsAvailableProvider = Provider.autoDispose<bool>((ref) {
  final locale = ref.watch(appStateProvider.select((s) => s.activeCourse?.track.voiceLocale));
  final course = ref.watch(appStateProvider.select((s) => s.activeCourse?.id));
  if (course == null) return false;
  return ref.watch(lineVoiceProvider(locale)).asData?.value.available ?? false;
});

AudioNarration narrationOf(AppLocalizations l10n) =>
    AudioNarration(intro: l10n.audioIntro, phrasesIntro: l10n.audioPhrasesIntro, againIntro: l10n.audioAgainIntro, outro: l10n.audioOutro);

/// The Audio tab: one lesson per mission of the active course, made from what the mission teaches.
class AudioLibraryScreen extends ConsumerWidget {
  const AudioLibraryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final course = appState.activeCourse;
    if (course == null) return const SizedBox.shrink();
    final voice = ref.watch(lineVoiceProvider(course.track.voiceLocale)).asData?.value;
    final listened = ref.watch(audioListenedProvider)[course.id] ?? const <String>{};
    final narration = narrationOf(l10n);

    return SafeArea(
      bottom: false,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
        children: [
          Semantics(
            header: true,
            child: Text(
              l10n.audioLibraryTitle,
              style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: colors.textPrimary),
            ),
          ),
          const SizedBox(height: 6),
          Text(l10n.audioLibraryBody, style: TextStyle(fontSize: 14.5, height: 1.4, color: colors.textSecondary)),
          if (voice != null && voice.available) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                Icon(voice.ai ? LucideIcons.audioLines : LucideIcons.volume2, size: 15, color: accent.primaryText),
                const SizedBox(width: 6),
                Text(
                  voice.ai ? l10n.audioReadByAi : l10n.audioReadByDevice,
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: accent.primaryText),
                ),
              ],
            ),
          ],
          const SizedBox(height: 16),
          for (final chapter in course.chapters) ...[
            if (course.chapters.length > 1 && (chapter.titleIn(course.source) ?? '').isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 8, 4, 8),
                child: Text(
                  chapter.titleIn(course.source)!.toUpperCase(),
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, letterSpacing: 0.8, color: colors.textMuted),
                ),
              ),
            for (final mission in chapter.missions)
              if (ref.watch(learnPlanProvider(mission.key)) case final plan?)
                _LessonTile(plan: plan, lesson: buildAudioLesson(plan, narration), listened: listened.contains(mission.key)),
          ],
        ],
      ),
    );
  }
}

class _LessonTile extends ConsumerWidget {
  const _LessonTile({required this.plan, required this.lesson, required this.listened});

  final MissionLearnPlan plan;
  final AudioLesson lesson;
  final bool listened;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final minutes = (lesson.estimatedLength.inSeconds / 60).ceil().clamp(1, 99);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: colors.surface,
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: () => context.push('/audio/${plan.mission.key}'),
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: colors.border),
            ),
            child: Row(
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(color: listened ? colors.successSoft : accent.primarySoft, borderRadius: BorderRadius.circular(14)),
                  child: Icon(listened ? LucideIcons.checkCheck : LucideIcons.headphones, color: listened ? colors.success : accent.primaryText),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        lesson.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700, color: colors.textPrimary),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        listened
                            ? '${l10n.audioLessonMeta(lesson.phraseCount, minutes)} · ${l10n.audioListened}'
                            : l10n.audioLessonMeta(lesson.phraseCount, minutes),
                        style: TextStyle(fontSize: 13, color: colors.textSecondary),
                      ),
                    ],
                  ),
                ),
                Icon(LucideIcons.play, color: accent.primaryText),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// One audio lesson: what is said now (big, with its meaning), the three parts, the transcript to jump around in,
/// and the controls: previous / play-pause / next, every line slowly, time to repeat on or off.
class AudioLessonScreen extends ConsumerStatefulWidget {
  const AudioLessonScreen({super.key, required this.missionKey});

  final String missionKey;

  @override
  ConsumerState<AudioLessonScreen> createState() => _AudioLessonScreenState();
}

class _AudioLessonScreenState extends ConsumerState<AudioLessonScreen> {
  AudioLessonPlayer? _player;
  final _scroll = ScrollController();
  final _keys = <int, GlobalKey>{};
  int _shownIndex = -1;

  @override
  void dispose() {
    _player?.removeListener(_onPlayer);
    _player?.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _onPlayer() {
    if (!mounted) return;
    final player = _player!;
    setState(() {});
    if (player.index != _shownIndex) {
      _shownIndex = player.index;
      // Keep the line being said in view.
      final key = _keys[player.index];
      final target = key?.currentContext;
      if (target != null) unawaited(Scrollable.ensureVisible(target, duration: const Duration(milliseconds: 300), alignment: 0.4));
    }
  }

  Future<AudioLessonPlayer?> _make(MissionLearnPlan plan) async {
    final voice = await ref.read(lineVoiceProvider(plan.voiceLocale).future);
    if (!voice.available || !mounted) return null;
    // The narration in the course's instruction language (the AI narrator signed in, else the device's voice for it).
    final narrator = ref.read(narratorProvider);
    final words = narrationWords(plan.source) ?? context.l10n;
    final narrates = narrator != null && (narrator.ai || await ref.read(speechServiceProvider).voiceForLanguage(plan.source) != null);
    if (!mounted) return null;
    final courseId = ref.read(appStateProvider).activeCourse?.id;
    final player = AudioLessonPlayer(
      lesson: buildAudioLesson(plan, narrationOf(words)),
      voice: voice,
      narrate: narrates ? narrator.say : null,
      onFinished: () {
        if (courseId != null) ref.read(audioListenedProvider.notifier).markListened(courseId, widget.missionKey);
      },
    )..addListener(_onPlayer);
    return player;
  }

  Future<void> _toggle(MissionLearnPlan plan) async {
    var player = _player;
    if (player == null) {
      player = await _make(plan);
      if (player == null || !mounted) return;
      setState(() => _player = player);
    }
    player.toggle();
  }

  @override
  Widget build(BuildContext context) {
    final plan = ref.watch(learnPlanProvider(widget.missionKey));
    if (plan == null) return const MissionUnavailable();
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final player = _player;
    final lesson = player?.lesson ?? buildAudioLesson(plan, narrationOf(l10n));
    final index = player?.index ?? 0;
    final step = lesson.steps[index];
    final playing = player?.playing ?? false;
    final sceneId = sceneIdForSituation(plan.mission.situation);
    final sections = [
      (AudioSection.conversation, l10n.audioSectionConversation),
      (AudioSection.phraseByPhrase, l10n.audioSectionPhrases),
      (AudioSection.conversationAgain, l10n.audioSectionAgain),
    ];

    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 4, 16, 0),
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
                          l10n.audioLessonLabel.toUpperCase(),
                          style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, letterSpacing: 0.8, color: colors.textMuted),
                        ),
                        Text(
                          lesson.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: colors.textPrimary),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
              child: Row(
                children: [
                  for (final (section, label) in sections)
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 3),
                        child: _SectionTab(
                          label: label,
                          active: step.section == section,
                          done: step.section.index > section.index,
                          onTap: player == null || lesson.startOf(section) < 0 ? null : () => player.seek(lesson.startOf(section)),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            Expanded(
              flex: 5,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
                child: LayoutBuilder(
                  builder: (context, box) => AnimatedSceneWidget(
                    sceneId: sceneId,
                    title: sceneTitle(l10n, sceneId),
                    height: box.maxHeight,
                    showTimeToggle: false,
                    child: Stack(
                      children: [
                        Padding(
                          padding: const EdgeInsets.fromLTRB(14, 44, 14, 14),
                          child: _NowPlaying(plan: plan, step: step, playing: playing, waited: player?.waited ?? 0, finished: player?.finished ?? false),
                        ),
                        if (player?.finished ?? false)
                          Positioned.fill(
                            child: ConfettiBurst(
                              colors: [accent.primary, colors.celebrationA, colors.celebrationB, colors.success],
                              count: 50,
                              origin: const Alignment(0, 0),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            Expanded(
              flex: 4,
              child: ListView(
                controller: _scroll,
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                children: [
                  for (var i = 0; i < lesson.steps.length; i++)
                    if (lesson.steps[i].kind == AudioStepKind.say)
                      _TranscriptLine(
                        key: _keys.putIfAbsent(i, GlobalKey.new),
                        plan: plan,
                        step: lesson.steps[i],
                        current: i == index || (lesson.steps[index].kind != AudioStepKind.say && i == _lineBefore(lesson, index)),
                        onTap: player == null ? null : () => player.seek(i),
                      ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  _Toggle(icon: LucideIcons.snail, label: l10n.audioSlowly, value: player?.slow ?? false, onChanged: player?.setSlow),
                  IconButton(
                    tooltip: l10n.audioPreviousLine,
                    onPressed: player?.previous,
                    icon: Icon(LucideIcons.skipBack, color: colors.textSecondary),
                  ),
                  Semantics(
                    button: true,
                    label: playing ? l10n.audioPause : (player?.finished ?? false ? l10n.audioPlayAgain : l10n.audioPlay),
                    excludeSemantics: true,
                    child: GestureDetector(
                      onTap: () => _toggle(plan),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        width: 72,
                        height: 72,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: accent.primary,
                          boxShadow: [
                            BoxShadow(
                              color: accent.primary.withValues(alpha: playing ? 0.55 : 0.3),
                              blurRadius: playing ? 20 : 10,
                              spreadRadius: playing ? 2 : 0,
                            ),
                          ],
                        ),
                        child: Icon(
                          playing ? LucideIcons.pause : (player?.finished ?? false ? LucideIcons.rotateCcw : LucideIcons.play),
                          size: 32,
                          color: accent.onPrimary,
                        ),
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: l10n.audioNextLine,
                    onPressed: player?.next,
                    icon: Icon(LucideIcons.skipForward, color: colors.textSecondary),
                  ),
                  _Toggle(icon: LucideIcons.mic, label: l10n.audioTurns, value: player?.turns ?? true, onChanged: player?.setTurns),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  static int _lineBefore(AudioLesson lesson, int index) {
    for (var i = index; i >= 0; i--) {
      if (lesson.steps[i].kind == AudioStepKind.say) return i;
    }
    return -1;
  }
}

class _SectionTab extends ConsumerWidget {
  const _SectionTab({required this.label, required this.active, required this.done, required this.onTap});

  final String label;
  final bool active;
  final bool done;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    return Semantics(
      button: onTap != null,
      selected: active,
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 48),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 12, fontWeight: active ? FontWeight.w800 : FontWeight.w600, color: active ? accent.primaryText : colors.textMuted),
              ),
              const SizedBox(height: 6),
              AnimatedContainer(
                duration: const Duration(milliseconds: 300),
                height: 4,
                decoration: BoxDecoration(color: active ? accent.primary : (done ? colors.success : colors.border), borderRadius: BorderRadius.circular(2)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// What is being said now: a line (big, with its meaning and who says it), the narration, or the learner's turn
/// with its countdown.
class _NowPlaying extends ConsumerWidget {
  const _NowPlaying({required this.plan, required this.step, required this.playing, required this.waited, required this.finished});

  final MissionLearnPlan plan;
  final AudioStep step;
  final bool playing;
  final double waited;
  final bool finished;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final card = BoxDecoration(
      color: colors.surface.withValues(alpha: 0.92),
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: colors.border),
    );
    Widget content;
    if (finished) {
      content = Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            LucideIcons.partyPopper,
            size: 34,
            color: accent.primaryText,
          ).withMotion(context, (a) => a.scale(begin: const Offset(0.4, 0.4), curve: Curves.elasticOut, duration: 700.ms)),
          const SizedBox(height: 8),
          Text(
            l10n.audioFinished,
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: colors.textPrimary),
          ),
        ],
      );
    } else {
      switch (step.kind) {
        case AudioStepKind.narrate || AudioStepKind.pause:
          content = Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(LucideIcons.messageSquareQuote, size: 20, color: colors.textMuted),
              const SizedBox(width: 10),
              Flexible(
                child: Text(
                  step.kind == AudioStepKind.narrate ? step.text : '…',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 17, height: 1.4, fontStyle: FontStyle.italic, color: colors.textSecondary),
                ),
              ),
            ],
          );
        case AudioStepKind.say || AudioStepKind.yourTurn:
          final line = step.expression!;
          final turn = step.kind == AudioStepKind.yourTurn;
          content = Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (turn)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    SizedBox.square(
                      dimension: 26,
                      child: CircularProgressIndicator(value: waited, strokeWidth: 3, color: accent.primary, backgroundColor: colors.border),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      l10n.audioYourTurn,
                      style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: accent.primaryText),
                    ),
                  ],
                )
              else if (step.speaker != null && step.speaker!.isNotEmpty)
                Text(
                  line.byLearner ? '${step.speaker} (${l10n.audioYou})' : step.speaker!,
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: colors.textMuted),
                ),
              const SizedBox(height: 8),
              Opacity(
                opacity: turn ? 0.7 : 1,
                child: TargetText(expression: line, track: plan.track, fontSize: 26, textAlign: TextAlign.center),
              ),
              const SizedBox(height: 6),
              Text(
                plan.meaningOf(line),
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 15, color: colors.textSecondary),
              ),
              if (playing && !turn) ...[const SizedBox(height: 10), _Equalizer(color: accent.primary)],
            ],
          );
      }
    }
    return Center(
      child: SingleChildScrollView(
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
          decoration: card,
          child: Semantics(
            liveRegion: true,
            child: AnimatedSwitcher(
              duration: context.reduceMotion ? Duration.zero : const Duration(milliseconds: 250),
              transitionBuilder: (child, a) => FadeTransition(
                opacity: a,
                child: SlideTransition(
                  position: Tween(begin: const Offset(0, 0.06), end: Offset.zero).animate(a),
                  child: child,
                ),
              ),
              child: KeyedSubtree(key: ValueKey((step, finished)), child: content),
            ),
          ),
        ),
      ),
    );
  }
}

/// Bars that move while a line plays (decorative).
class _Equalizer extends StatelessWidget {
  const _Equalizer({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) {
    return ExcludeSemantics(
      child: Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          for (var i = 0; i < 5; i++)
            Container(
              width: 4,
              height: 16,
              margin: const EdgeInsets.symmetric(horizontal: 2),
              decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(2)),
            ).withMotion(
              context,
              (a) => a
                  .animate(onPlay: (c) => c.repeat(reverse: true))
                  .scaleY(begin: 0.25, end: 1, alignment: Alignment.bottomCenter, delay: (i * 90).ms, duration: (300 + i * 40).ms, curve: Curves.easeInOut),
            ),
        ],
      ),
    );
  }
}

class _TranscriptLine extends ConsumerWidget {
  const _TranscriptLine({super.key, required this.plan, required this.step, required this.current, required this.onTap});

  final MissionLearnPlan plan;
  final AudioStep step;
  final bool current;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final line = step.expression!;
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Material(
        color: current ? accent.primarySoft : Colors.transparent,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Container(
            constraints: const BoxConstraints(minHeight: 48),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              children: [
                Icon(
                  step.section == AudioSection.phraseByPhrase ? LucideIcons.repeat2 : (line.byLearner ? LucideIcons.user : LucideIcons.messageCircle),
                  size: 15,
                  color: current ? accent.primaryText : colors.textMuted,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      TargetText(expression: line, track: plan.track, fontSize: 15.5),
                      Text(plan.shortMeaningOf(line), style: TextStyle(fontSize: 12.5, color: colors.textMuted)),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Toggle extends ConsumerWidget {
  const _Toggle({required this.icon, required this.label, required this.value, required this.onChanged});

  final IconData icon;
  final String label;
  final bool value;
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    return Semantics(
      toggled: value,
      label: label,
      button: true,
      excludeSemantics: true,
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onChanged == null ? null : () => onChanged!(!value),
        child: Container(
          constraints: const BoxConstraints(minWidth: 56, minHeight: 56),
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 20, color: value ? accent.primaryText : colors.textMuted),
              const SizedBox(height: 2),
              Text(
                label,
                style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: value ? accent.primaryText : colors.textMuted),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
