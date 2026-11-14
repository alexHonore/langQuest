import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show ProviderListenable;
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/backend/narrator.dart';
import '../../core/backend/server_voice.dart';
import '../../core/backend/speech_check.dart';
import '../../core/layout/celebration.dart';
import '../../core/layout/motion.dart';
import '../../core/services/app_state.dart';
import '../../core/services/learner_store.dart';
import '../../core/content/content_bundle.dart' show Course;
import '../../core/content/content_models.dart';
import '../../core/theme/typography.dart';
import '../../l10n/l10n.dart';
import '../../navigation/nav.dart';
import '../learn/learn_content.dart';
import '../learn/learn_logic.dart';
import '../learn/learn_providers.dart';
import '../learn/learn_widgets.dart';
import '../learn/record_take.dart';
import '../scenes/animated_scene.dart';
import '../scenes/scene_models.dart';
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

/// Whether the active course's lessons can be heard here (its bundled clips, a device voice for it, or the server's AI
/// voice): the Audio tab exists only then (visible means usable). The bundled clips count at once, so the tab does not
/// wait for the device to list its own voices.
final audioLessonsAvailableProvider = Provider.autoDispose<bool>((ref) {
  final locale = ref.watch(appStateProvider.select((s) => s.activeCourse?.track.voiceLocale));
  final course = ref.watch(appStateProvider.select((s) => s.activeCourse?.id));
  if (course == null) return false;
  return ref.watch(lineVoiceNowProvider(locale))?.available ?? false;
});

AudioNarration narrationOf(AppLocalizations l10n) => AudioNarration(
  intro: l10n.audioIntro,
  phrasesIntro: l10n.audioPhrasesIntro,
  recallIntro: l10n.audioRecallIntro,
  recallPrompt: l10n.missionHowDoYouSay,
  rolePlayIntro: l10n.audioRolePlayIntro,
  sayCue: l10n.audioSayCue,
  outro: l10n.audioOutro,
  mixConversationsIntro: l10n.audioMixConversationsIntro,
  mixRecallIntro: l10n.audioMixRecallIntro,
);

/// How a provider is read: `ref.watch` while building, `ref.read` anywhere else.
typedef ProviderReader = T Function<T>(ProviderListenable<T> provider);

/// Whether [plan]'s lesson can be heard with [voice]: every line of it can be said here. A chapter whose lines have
/// no recorded clip yet is heard only where the device (or the server) has a voice for the course; elsewhere its
/// lessons are not offered (visible means usable).
bool planAudible(MissionLearnPlan plan, LineVoice? voice) =>
    voice != null &&
    voice.available &&
    plan.sceneLines.every((l) => voice.canSay(expressionId: l.expression.id)) &&
    plan.phrases.every((e) => voice.canSay(expressionId: e.id));

/// The learn plans of [course]'s missions whose lesson can be heard here, in order ([learnedOnly]: those whose Learn
/// stop is done).
List<MissionLearnPlan> coursePlans(ProviderReader read, Course course, {bool learnedOnly = false}) {
  final stops = read(appStateProvider.select((s) => s.progress.stops));
  final voice = read(lineVoiceNowProvider(course.track.voiceLocale));
  return [
    for (final mission in course.missions)
      if (!learnedOnly || (stops[mission.key]?.contains(PathStop.learn) ?? false))
        if (read(learnPlanProvider(mission.key)) case final plan? when planAudible(plan, voice)) plan,
  ];
}

/// Whether [missionKey]'s audio lesson can be heard here.
final audioLessonAudibleProvider = Provider.autoDispose.family<bool, String>((ref, missionKey) {
  final plan = ref.watch(learnPlanProvider(missionKey));
  return plan != null && planAudible(plan, ref.watch(lineVoiceNowProvider(plan.voiceLocale)));
});

/// A mix of [course], narrated with [words]; null when there is nothing to make it from (a recall before anything
/// was learned).
AudioLesson? buildMix(ProviderReader read, Course course, AudioMix mix, AppLocalizations words, AppLocalizations l10n) {
  switch (mix) {
    case AudioMix.conversations:
      final plans = coursePlans(read, course);
      return plans.length < 2 ? null : buildConversationsMix(plans, narrationOf(words), title: l10n.audioMixConversationsTitle);
    case AudioMix.recall:
      final learned = coursePlans(read, course, learnedOnly: true);
      return learned.isEmpty ? null : buildRecallMix(learned, narrationOf(words), title: l10n.audioMixRecallTitle);
  }
}

String audioSectionLabel(AppLocalizations l10n, AudioSection section) => switch (section) {
  AudioSection.conversation => l10n.audioSectionConversation,
  AudioSection.phraseByPhrase => l10n.audioSectionPhrases,
  AudioSection.recall => l10n.audioSectionRecall,
  AudioSection.rolePlay => l10n.audioSectionRolePlay,
};

int _minutes(Duration length) => (length.inSeconds / 60).ceil().clamp(1, 99);

/// The Audio tab: the course's mixes (every conversation back to back; a recall of what was learned), then one lesson
/// per mission, made from what the mission teaches.
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
    final conversations = buildMix(ref.watch, course, AudioMix.conversations, l10n, l10n);
    final recall = buildMix(ref.watch, course, AudioMix.recall, l10n, l10n);

    return SafeArea(
      bottom: false,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 110),
        children: [
          Semantics(
            header: true,
            child: Text(l10n.audioLibraryTitle, style: displayStyle(size: 28, color: colors.textPrimary)),
          ),
          const SizedBox(height: 6),
          Text(l10n.audioLibraryBody, style: TextStyle(fontSize: 14.5, height: 1.4, color: colors.textSecondary)),
          if (voice != null && voice.available) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                Icon(voice.ai ? LucideIcons.audioLines : LucideIcons.volume2, size: 15, color: accent.primaryText),
                const SizedBox(width: 6),
                Flexible(
                  child: Text(
                    voice.ai ? l10n.audioReadByAi : l10n.audioReadByDevice,
                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: accent.primaryText),
                  ),
                ),
              ],
            ),
          ],
          if (conversations != null || recall != null) ...[
            const SizedBox(height: 20),
            Text(l10n.audioMixesTitle, style: displayStyle(size: 18, color: colors.textPrimary, bold: false)),
            const SizedBox(height: 10),
            if (recall != null)
              _MixTile(
                icon: LucideIcons.brain,
                tint: colors.amberText,
                title: recall.title,
                body: l10n.audioMixRecallBody(recall.phraseCount),
                minutes: _minutes(recall.estimatedLength),
                onTap: () => context.push('/audio/mix/${AudioMix.recall.kind}'),
              ),
            if (conversations != null)
              _MixTile(
                icon: LucideIcons.messagesSquare,
                tint: colors.cyanText,
                title: conversations.title,
                body: l10n.audioMixConversationsBody(coursePlans(ref.watch, course).length),
                minutes: _minutes(conversations.estimatedLength),
                onTap: () => context.push('/audio/mix/${AudioMix.conversations.kind}'),
              ),
          ],
          const SizedBox(height: 14),
          // A chapter is listed with the lessons that can be heard here (all of them where the course has a voice).
          for (final chapter in course.chapters)
            if ([
                  for (final mission in chapter.missions)
                    if (ref.watch(audioLessonAudibleProvider(mission.key))) ?ref.watch(learnPlanProvider(mission.key)),
                ]
                case final plans when plans.isNotEmpty) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(0, 6, 0, 10),
                child: Text(
                  (chapter.titleIn(course.source) ?? '').isEmpty ? l10n.chapterLabel(chapter.chapterIndex) : chapter.titleIn(course.source)!,
                  style: displayStyle(size: 18, color: colors.textPrimary, bold: false),
                ),
              ),
              for (final plan in plans) _LessonTile(plan: plan, lesson: buildAudioLesson(plan, narration), listened: listened.contains(plan.mission.key)),
            ],
        ],
      ),
    );
  }
}

/// A mix: a lesson made from the whole course.
class _MixTile extends ConsumerWidget {
  const _MixTile({required this.icon, required this.tint, required this.title, required this.body, required this.minutes, required this.onTap});

  final IconData icon;
  final Color tint;
  final String title;
  final String body;
  final int minutes;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    final l10n = context.l10n;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Semantics(
        button: true,
        label: '$title. $body. ${l10n.audioAboutMinutes(minutes)}',
        excludeSemantics: true,
        child: Material(
          color: colors.elevated,
          borderRadius: BorderRadius.circular(20),
          child: InkWell(
            borderRadius: BorderRadius.circular(20),
            onTap: onTap,
            child: Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: tint.withValues(alpha: 0.45)),
              ),
              child: Row(
                children: [
                  Container(
                    width: 52,
                    height: 52,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: tint.withValues(alpha: 0.16),
                      boxShadow: [BoxShadow(color: tint.withValues(alpha: 0.25), blurRadius: 16)],
                    ),
                    child: Icon(icon, size: 24, color: tint),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(title, style: displayStyle(size: 17, color: colors.textPrimary)),
                        const SizedBox(height: 2),
                        Text(body, style: TextStyle(fontSize: 13.5, height: 1.35, color: colors.textSecondary)),
                        const SizedBox(height: 2),
                        Text(l10n.audioAboutMinutes(minutes), style: TextStyle(fontSize: 12.5, color: colors.textMuted)),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Icon(LucideIcons.play, size: 20, color: colors.textMuted),
                ],
              ),
            ),
          ),
        ),
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
    final minutes = _minutes(lesson.estimatedLength);
    final sceneId = sceneIdForMission(plan.mission);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: colors.surface,
        borderRadius: BorderRadius.circular(20),
        child: InkWell(
          borderRadius: BorderRadius.circular(20),
          onTap: () => context.push('/audio/${plan.mission.key}'),
          child: Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: colors.border),
            ),
            child: Row(
              children: [
                // The mission's place, with whether the lesson was heard to the end.
                Stack(
                  children: [
                    RepaintBoundary(
                      child: AnimatedSceneWidget(sceneId: sceneId, height: 60, width: 78, radius: 14, animate: false, showTitle: false, showTimeToggle: false),
                    ),
                    if (listened)
                      PositionedDirectional(
                        end: 4,
                        bottom: 4,
                        child: Container(
                          width: 22,
                          height: 22,
                          decoration: BoxDecoration(shape: BoxShape.circle, color: colors.success),
                          child: Icon(LucideIcons.check, size: 14, color: colors.background),
                        ),
                      ),
                  ],
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
                        style: TextStyle(fontSize: 15.5, height: 1.25, fontWeight: FontWeight.w600, color: colors.textPrimary),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        listened
                            ? '${l10n.audioLessonMeta(lesson.phraseCount, minutes)} · ${l10n.audioListened}'
                            : l10n.audioLessonMeta(lesson.phraseCount, minutes),
                        style: TextStyle(fontSize: 13, color: listened ? colors.success : colors.textSecondary),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 6),
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(shape: BoxShape.circle, color: accent.primarySoft),
                  child: Icon(LucideIcons.play, size: 18, color: accent.primaryText),
                ),
                const SizedBox(width: 4),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// One audio lesson — a mission's, or a mix of the course: what is said now (big, with its meaning), its parts, how
/// much is left, the transcript to jump around in, and the controls: previous / play-pause / next, every line slowly,
/// time to repeat on or off. Where a phrase is asked from memory, it stays hidden (here and in the transcript) until
/// it has been said.
class AudioLessonScreen extends ConsumerStatefulWidget {
  const AudioLessonScreen({super.key, required String this.missionKey}) : mix = null;

  /// A mix of the active course (`conversations`, `recall`).
  const AudioLessonScreen.mix({super.key, required String kind}) : missionKey = null, mix = kind;

  final String? missionKey;
  final String? mix;

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

  /// The learner's turn in progress: its takes so far (a turn waits for the phrase, as speaking steps do).
  final _turn = SpeakingStep();

  void _onPlayer() {
    if (!mounted) return;
    final player = _player!;
    setState(() {});
    if (player.index != _shownIndex) {
      _shownIndex = player.index;
      _turn.reset();
      // Keep the line being said in view.
      final key = _keys[player.index];
      final target = key?.currentContext;
      if (target != null) unawaited(Scrollable.ensureVisible(target, duration: const Duration(milliseconds: 300), alignment: 0.4));
    }
  }

  /// The lesson of this screen, narrated with [words]: its mission's, or the mix of the active course.
  AudioLesson? _lesson(ProviderReader read, AppLocalizations words) {
    final key = widget.missionKey;
    if (key != null) {
      final plan = read(learnPlanProvider(key));
      return plan == null || !read(audioLessonAudibleProvider(key)) ? null : buildAudioLesson(plan, narrationOf(words));
    }
    final course = read(appStateProvider.select((s) => s.activeCourse));
    final mix = AudioMix.of(widget.mix ?? '');
    return course == null || mix == null ? null : buildMix(read, course, mix, words, context.l10n);
  }

  Future<AudioLessonPlayer?> _make(Course course) async {
    final voice = await ref.read(lineVoiceProvider(course.track.voiceLocale).future);
    if (!voice.available || !mounted) return null;
    // The narration in the course's instruction language: the AI narrator (signed in), else none (never the device's
    // synthetic voice).
    await narrationReady(ref);
    if (!mounted) return null;
    final narrator = ref.read(narratorProvider);
    final words = narrationWords(course.source) ?? context.l10n;
    final narrates = narrator != null && narrator.ai;
    final lesson = _lesson(ref.read, words);
    if (lesson == null) return null;
    final player =
        AudioLessonPlayer(
            lesson: lesson,
            voice: voice,
            narrate: narrates ? narrator.say : null,
            onFinished: () => ref.read(audioListenedProvider.notifier).markListened(course.id, lesson.id),
          )
          ..speakAtTurns = speakingRequiredNow(ref)
          ..addListener(_onPlayer);
    return player;
  }

  Future<void> _toggle(Course course) async {
    var player = _player;
    if (player == null) {
      player = await _make(course);
      if (player == null || !mounted) return;
      setState(() => _player = player);
    }
    player.toggle();
  }

  /// The mission the step at [index] belongs to (a narration takes the one of the lines around it).
  static MissionLearnPlan? _originAt(AudioLesson lesson, int index) {
    for (var i = index; i >= 0; i--) {
      if (lesson.steps[i].origin case final plan?) return plan;
    }
    for (var i = index + 1; i < lesson.steps.length; i++) {
      if (lesson.steps[i].origin case final plan?) return plan;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final appState = ref.watch(appStateProvider);
    final course = appState.activeCourse;
    final l10n = context.l10n;
    final player = _player;
    final lesson = player?.lesson ?? (course == null ? null : _lesson(ref.watch, l10n));
    if (course == null || lesson == null || lesson.steps.isEmpty) return const MissionUnavailable();
    final colors = appState.colors;
    final accent = appState.accent;
    // "Can't speak now" (or its end) changes whether turns wait for the phrase.
    ref.listen(speakingPauseProvider, (_, _) => _player?.setSpeakAtTurns(speakingRequiredNow(ref)));
    final index = (player?.index ?? 0).clamp(0, lesson.steps.length - 1);
    final step = lesson.steps[index];
    final playing = player?.playing ?? false;
    final finished = player?.finished ?? false;
    final origin = _originAt(lesson, index);
    final sceneId = origin == null ? SceneId.street : sceneIdForMission(origin.mission);
    final sections = lesson.sections;
    final left = finished ? Duration.zero : lesson.lengthFrom(index);

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
                          widget.mix == null ? l10n.audioLessonLabel : l10n.audioMixLabel,
                          style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: accent.primaryText),
                        ),
                        Text(
                          lesson.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: displayStyle(size: 18, color: colors.textPrimary),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            // How far the lesson is, and roughly how long is left.
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Semantics(
                label: finished ? l10n.audioFinished : l10n.audioTimeLeft(_minutes(left)),
                excludeSemantics: true,
                child: Row(
                  children: [
                    Expanded(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(3),
                        child: SizedBox(
                          height: 6,
                          child: Stack(
                            fit: StackFit.expand,
                            children: [
                              ColoredBox(color: colors.surfaceMuted),
                              FractionallySizedBox(
                                alignment: AlignmentDirectional.centerStart,
                                widthFactor: finished ? 1 : (index / (lesson.steps.length - 1).clamp(1, 1 << 30)).clamp(0.0, 1.0),
                                child: DecoratedBox(
                                  decoration: BoxDecoration(gradient: LinearGradient(colors: [accent.primary, accent.lantern[1]])),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Text(finished ? l10n.audioListened : l10n.audioTimeLeft(_minutes(left)), style: TextStyle(fontSize: 12.5, color: colors.textMuted)),
                  ],
                ),
              ),
            ),
            if (sections.length > 1)
              Padding(
                padding: const EdgeInsets.fromLTRB(13, 4, 13, 0),
                child: Row(
                  children: [
                    for (final section in sections)
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 3),
                          child: _SectionTab(
                            label: audioSectionLabel(l10n, section),
                            active: step.section == section,
                            done: step.section.index > section.index,
                            onTap: player == null || (player.awaitingSpeech && lesson.startOf(section) > index)
                                ? null
                                : () => player.seek(lesson.startOf(section)),
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
                    key: ValueKey(sceneId),
                    sceneId: sceneId,
                    title: sceneTitle(l10n, sceneId),
                    height: box.maxHeight,
                    showTimeToggle: false,
                    child: Stack(
                      children: [
                        Padding(
                          padding: const EdgeInsets.fromLTRB(14, 44, 14, 14),
                          child: _NowPlaying(
                            track: course.track,
                            step: step,
                            origin: origin,
                            playing: playing,
                            waited: player?.waited ?? 0,
                            finished: finished,
                            // The turn waits for the phrase: a take, checked where the server can.
                            speak: player != null && player.awaitingSpeech
                                ? (
                                    index: index,
                                    tries: _turn.tries,
                                    onTake: (TakeOutcome outcome) => setState(() {
                                      if (_turn.take(outcome)) player.spoke();
                                    }),
                                  )
                                : null,
                          ),
                        ),
                        if (finished)
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
                        track: course.track,
                        step: lesson.steps[i],
                        current: i == index || (lesson.steps[index].kind != AudioStepKind.say && i == _lineBefore(lesson, index)),
                        // A phrase to find from memory is not given away by the transcript before its turn.
                        hidden: !finished && i > index && _asked(lesson, i),
                        onTap: player == null || (player.awaitingSpeech && i > index) ? null : () => player.seek(i),
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
                    label: playing ? l10n.audioPause : (finished ? l10n.audioPlayAgain : l10n.audioPlay),
                    excludeSemantics: true,
                    child: GestureDetector(
                      onTap: () => _toggle(course),
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
                        child: Icon(playing ? LucideIcons.pause : (finished ? LucideIcons.rotateCcw : LucideIcons.play), size: 32, color: accent.onPrimary),
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: l10n.audioNextLine,
                    // Not past a turn that waits for the phrase (say it, or "Can't speak now").
                    onPressed: player == null || player.awaitingSpeech ? null : player.next,
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

  /// Whether the line at [index] answers a turn from memory (the step right before it asks for it).
  static bool _asked(AudioLesson lesson, int index) =>
      index > 0 && lesson.steps[index - 1].kind == AudioStepKind.yourTurn && lesson.steps[index - 1].fromMemory;
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
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (done) ...[Icon(LucideIcons.check, size: 12, color: colors.success), const SizedBox(width: 3)],
                  Flexible(
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                        color: active ? accent.primaryText : (done ? colors.textSecondary : colors.textMuted),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              AnimatedContainer(
                duration: const Duration(milliseconds: 300),
                height: 3,
                decoration: BoxDecoration(color: active ? accent.primary : Colors.transparent, borderRadius: BorderRadius.circular(2)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// What is being said now: a line (big, with its meaning and who says it), the narration, or the learner's turn
/// with its countdown — the phrase itself hidden when it is asked from memory.
class _NowPlaying extends ConsumerWidget {
  const _NowPlaying({
    required this.track,
    required this.step,
    required this.origin,
    required this.playing,
    required this.waited,
    required this.finished,
    this.speak,
  });

  /// The turn waits for the learner to say the phrase: the step's index, the takes so far, and what each take came to.
  final ({int index, int tries, ValueChanged<TakeOutcome> onTake})? speak;

  final CourseTrackInfo track;
  final AudioStep step;

  /// The mission the line comes from: its meaning, and what a checked take is checked against.
  final MissionLearnPlan? origin;
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
      color: colors.surface.withValues(alpha: 0.93),
      borderRadius: BorderRadius.circular(22),
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
          Text(l10n.audioFinished, style: displayStyle(size: 22, color: colors.textPrimary)),
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
          final meaning = origin?.meaningOf(line) ?? '';
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
                    Flexible(
                      child: Text(
                        step.fromMemory ? l10n.audioYourTurnRecall : l10n.audioYourTurn,
                        style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: accent.primaryText),
                      ),
                    ),
                  ],
                )
              else if (step.speaker != null && step.speaker!.isNotEmpty)
                Text(
                  line.byLearner ? '${step.speaker} (${l10n.audioYou})' : step.speaker!,
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: colors.textMuted),
                )
              else if (line.byLearner && step.section == AudioSection.rolePlay)
                Text(
                  l10n.audioYou,
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: accent.primaryText),
                ),
              const SizedBox(height: 8),
              // From memory: the meaning is the question; the phrase shows once it is said.
              if (turn && step.fromMemory)
                Text(
                  meaning,
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 22, height: 1.3, fontWeight: FontWeight.w700, color: colors.textPrimary),
                )
              else ...[
                Opacity(
                  opacity: turn ? 0.7 : 1,
                  child: TargetText(expression: line, track: track, fontSize: 26, textAlign: TextAlign.center),
                ),
                const SizedBox(height: 6),
                Text(
                  meaning,
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 15, color: colors.textSecondary),
                ),
              ],
              if (playing && !turn) ...[const SizedBox(height: 10), _Equalizer(color: accent.primary)],
              if (turn && speak != null) ...[
                const SizedBox(height: 12),
                RecordTake(
                  key: ValueKey('turn-${speak!.index}'),
                  voiceLocale: track.voiceLocale,
                  centered: true,
                  autoFeedback: false,
                  check: origin == null ? null : SpeechTarget(expressionId: line.id, chapterKey: origin!.mission.chapterKey, missionKey: origin!.mission.key),
                  onTake: speak!.onTake,
                ),
                const SizedBox(height: 6),
                SpeakingHint(tries: speak!.tries),
              ],
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
  const _TranscriptLine({super.key, required this.track, required this.step, required this.current, required this.hidden, required this.onTap});

  final CourseTrackInfo track;
  final AudioStep step;
  final bool current;

  /// The phrase is still to be found from memory: only its meaning is written.
  final bool hidden;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final line = step.expression!;
    final meaning = step.origin?.shortMeaningOf(line) ?? '';
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Material(
        color: current ? accent.primarySoft : Colors.transparent,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: onTap,
          child: Container(
            constraints: const BoxConstraints(minHeight: 48),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              children: [
                Icon(
                  switch (step.section) {
                    AudioSection.phraseByPhrase => LucideIcons.repeat2,
                    AudioSection.recall => LucideIcons.brain,
                    AudioSection.conversation || AudioSection.rolePlay => line.byLearner ? LucideIcons.user : LucideIcons.messageCircle,
                  },
                  size: 15,
                  color: current ? accent.primaryText : colors.textMuted,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: hidden
                      ? Text(
                          meaning,
                          style: TextStyle(fontSize: 14.5, height: 1.3, fontStyle: FontStyle.italic, color: colors.textMuted),
                        )
                      : Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            TargetText(expression: line, track: track, fontSize: 15.5),
                            Text(meaning, style: TextStyle(fontSize: 12.5, color: colors.textMuted)),
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
