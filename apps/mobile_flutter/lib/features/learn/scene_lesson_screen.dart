import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../navigation/nav.dart';
import '../../core/backend/narrator.dart';
import '../../core/backend/server_voice.dart';
import '../../core/backend/speech_check.dart';
import '../../core/layout/motion.dart';
import '../../core/services/app_state.dart';
import '../../core/services/speech_service.dart';
import '../../l10n/l10n.dart';
import '../mascot/melo_model.dart';
import '../mascot/melo_widget.dart';
import '../scenes/animated_scene.dart';
import 'learn_content.dart';
import 'learn_providers.dart';
import 'learn_widgets.dart';
import 'record_take.dart';

/// L1 — "watch it happen": the mission's dialogue plays line by line. The character's lines are heard (device
/// voice when one exists for the variety, labelled synthetic), every line shows in the target script with its
/// romanization and meaning, and on the learner's own lines the learner shadows it out loud (and, where the device
/// can record, records it to hear next to the reference). Nothing is scored and nothing is asked yet. The lines
/// already heard stay above as the thread of the conversation, under the place where it happens; the thread scrolls,
/// so the line being taught is never cut at any text size.
class SceneLessonScreen extends ConsumerStatefulWidget {
  final String missionKey;
  const SceneLessonScreen({super.key, required this.missionKey});

  @override
  ConsumerState<SceneLessonScreen> createState() => _SceneLessonScreenState();
}

class _SceneLessonScreenState extends ConsumerState<SceneLessonScreen> {
  int _index = 0;
  bool _speaking = false;
  int _utterance = 0;
  late final SpeechService _speech;

  /// The learner's line has to be said (with a microphone) before moving on.
  final _step = SpeakingStep();

  /// The conversation so far, above the line being taught: it follows the newest line.
  final _thread = ScrollController();

  @override
  void initState() {
    super.initState();
    _speech = ref.read(speechServiceProvider);
    WidgetsBinding.instance.addPostFrameCallback((_) => _speakCurrent());
  }

  @override
  void dispose() {
    _speech.stop();
    _thread.dispose();
    super.dispose();
  }

  /// Brings the line being taught into view (after the frame that added it).
  void _followThread() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_thread.hasClients) return;
      final end = _thread.position.maxScrollExtent;
      if (context.reduceMotion) {
        _thread.jumpTo(end);
      } else {
        _thread.animateTo(end, duration: const Duration(milliseconds: 280), curve: Curves.easeOutCubic);
      }
    });
  }

  Future<void> _speakCurrent({bool slow = false}) async {
    final plan = ref.read(learnPlanProvider(widget.missionKey));
    if (plan == null) return;
    final token = ++_utterance;
    ref.read(narratorProvider)?.stop();
    // Read aloud: the scene's context before its first line, and "Your line — say it out loud" before the learner's.
    final read = readAloudFor(ref);
    if (read != null) {
      final note = _index == 0 ? plan.mission.sceneNoteIn(plan.source) : null;
      if (note != null) await read.narrator.say(note);
      if (!mounted || token != _utterance) return;
      if (plan.sceneLines[_index].byLearner) await read.narrator.say(read.words.sceneYourLine);
      if (!mounted || token != _utterance) return;
    }
    // The course's voice: the server's AI voice (signed in), else the device's, else none.
    final voice = await ref.read(lineVoiceProvider(plan.voiceLocale).future);
    if (!voice.available || !mounted || token != _utterance) return;
    setState(() => _speaking = true);
    final line = plan.sceneLines[_index].expression;
    await voice.say(text: line.text, expressionId: line.id, slow: slow);
    // A newer line may have started meanwhile; only the latest utterance clears the speaking state.
    if (mounted && token == _utterance) setState(() => _speaking = false);
  }

  void _next(MissionLearnPlan plan) {
    if (_index < plan.sceneLines.length - 1) {
      _step.reset();
      setState(() => _index++);
      _followThread();
      _speakCurrent();
    } else {
      _utterance++;
      _speech.stop();
      context.pushReplacement('/learn/${widget.missionKey}/cards');
    }
  }

  @override
  Widget build(BuildContext context) {
    final plan = ref.watch(learnPlanProvider(widget.missionKey));
    if (plan == null || plan.sceneLines.isEmpty) return const MissionUnavailable();
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final index = _index.clamp(0, plan.sceneLines.length - 1);
    final line = plan.sceneLines[index];
    final hasVoice = ref.watch(lineVoiceProvider(plan.voiceLocale)).asData?.value.available ?? false;
    final learnerTurn = line.byLearner;
    final meloState = _speaking ? MeloState.curious : (learnerTurn ? MeloState.welcome : MeloState.companion);
    final sceneId = sceneIdForMission(plan.mission);
    final isLast = index == plan.sceneLines.length - 1;
    final note = plan.noteOf(line.expression);
    // The learner's line waits for a take (understood where the server checks), unless speaking is paused.
    final waiting = learnerTurn && speakingRequired(ref) && !_step.done;

    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: Column(
          children: [
            LearnTopBar(
              title: l10n.sceneTitle(plan.mission.titleIn(plan.source) ?? ''),
              step: index + 1,
              total: plan.sceneLines.length,
              onClose: () => context.popOrHome(),
            ),
            // The place, with who is speaking: the character, or the learner.
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Builder(
                builder: (context) {
                  final height = (MediaQuery.sizeOf(context).height * 0.17).clamp(96.0, 150.0);
                  final badge = (height * 0.42).clamp(40.0, 60.0);
                  return AnimatedSceneWidget(
                    sceneId: sceneId,
                    title: sceneTitle(l10n, sceneId),
                    height: height,
                    showTimeToggle: false,
                    child: Stack(
                      children: [
                        Center(
                          child: CharacterBadge(name: learnerTurn ? l10n.you : line.speakerName, speaking: _speaking && !learnerTurn, size: badge),
                        ),
                        Positioned(
                          left: 8,
                          bottom: 6,
                          child: MeloWidget(state: meloState, courseTrackId: appState.activeTrackId, size: (badge * 0.8).clamp(34.0, 52.0)),
                        ),
                        if (hasVoice)
                          Positioned(
                            right: 10,
                            top: 10,
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(color: const Color(0xB30B0913), borderRadius: BorderRadius.circular(10)),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const Icon(LucideIcons.audioLines, size: 12, color: Colors.white70),
                                  const SizedBox(width: 4),
                                  Text(l10n.syntheticVoice, style: const TextStyle(fontSize: 11, color: Colors.white70)),
                                ],
                              ),
                            ),
                          ),
                      ],
                    ),
                  );
                },
              ),
            ),
            // The conversation so far, then the line being taught: who says it, target text (+ romanization),
            // meaning, and the note when there is one.
            Expanded(
              child: SingleChildScrollView(
                controller: _thread,
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (final past in plan.sceneLines.take(index))
                      LineBubble(
                        expression: past.expression,
                        track: plan.track,
                        meaning: plan.meaningOf(past.expression),
                        byLearner: past.byLearner,
                        speakerName: past.speakerName,
                        faded: true,
                        fontSize: 16,
                      ),
                    Container(
                      key: ValueKey(index),
                      width: double.infinity,
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: learnerTurn ? accent.primarySoft : colors.surface,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: learnerTurn ? accent.primary.withValues(alpha: 0.7) : colors.border, width: learnerTurn ? 1.5 : 1),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            learnerTurn ? l10n.sceneYourLine : line.speakerName,
                            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: learnerTurn ? accent.primaryText : colors.textMuted),
                          ),
                          const SizedBox(height: 6),
                          SizedBox(
                            width: double.infinity,
                            child: TargetText(expression: line.expression, track: plan.track, fontSize: 24),
                          ),
                          const SizedBox(height: 6),
                          Text(plan.meaningOf(line.expression), style: TextStyle(fontSize: 15, height: 1.3, color: colors.textSecondary)),
                          if (note != null) ...[
                            const SizedBox(height: 4),
                            Text(
                              note,
                              maxLines: 3,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(fontSize: 12.5, color: colors.textMuted),
                            ),
                          ],
                          const SizedBox(height: 10),
                          ListenButtons(text: line.expression.text, expressionId: line.expression.id, locale: plan.voiceLocale, compact: true),
                          if (learnerTurn) ...[
                            const SizedBox(height: 8),
                            RecordTake(
                              key: ValueKey('take-$index'),
                              voiceLocale: plan.voiceLocale,
                              check: SpeechTarget(expressionId: line.expression.id, chapterKey: plan.mission.chapterKey, missionKey: plan.mission.key),
                              onTake: (outcome) => setState(() => _step.take(outcome)),
                            ),
                          ],
                        ],
                      ),
                      // Each line arrives from its speaker's side, as in a conversation.
                    ).withMotion(
                      context,
                      (a) => a.fadeIn(duration: 260.ms).slideX(begin: learnerTurn ? 0.1 : -0.1, end: 0, duration: 300.ms, curve: Curves.easeOutCubic),
                    ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (waiting)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: SpeakingHint(tries: _step.tries),
                    ),
                  LearnPrimaryButton(
                    label: learnerTurn ? l10n.sceneISaidIt : (isLast ? l10n.sceneLearnPhrases : l10n.next),
                    icon: LucideIcons.chevronRight,
                    onPressed: waiting ? null : () => _next(plan),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
