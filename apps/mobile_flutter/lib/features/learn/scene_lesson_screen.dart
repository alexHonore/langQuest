import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../navigation/nav.dart';
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
/// can record, records it to hear next to the reference). Nothing is scored and nothing is asked yet. Fits the
/// screen: the scene takes the height left after the line card and button.
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

  @override
  void initState() {
    super.initState();
    _speech = ref.read(speechServiceProvider);
    WidgetsBinding.instance.addPostFrameCallback((_) => _speakCurrent());
  }

  @override
  void dispose() {
    _speech.stop();
    super.dispose();
  }

  Future<void> _speakCurrent({bool slow = false}) async {
    final plan = ref.read(learnPlanProvider(widget.missionKey));
    if (plan == null) return;
    // The device's voice for the course, else the server's AI voice (signed in), else none.
    final voice = await ref.read(lineVoiceProvider(plan.voiceLocale).future);
    if (!voice.available || !mounted) return;
    final token = ++_utterance;
    setState(() => _speaking = true);
    final line = plan.sceneLines[_index].expression;
    await voice.say(text: line.text, expressionId: line.id, slow: slow);
    // A newer line may have started meanwhile; only the latest utterance clears the speaking state.
    if (mounted && token == _utterance) setState(() => _speaking = false);
  }

  void _next(MissionLearnPlan plan) {
    if (_index < plan.sceneLines.length - 1) {
      setState(() => _index++);
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
    final sceneId = sceneIdForSituation(plan.mission.situation);
    final isLast = index == plan.sceneLines.length - 1;
    final note = plan.noteOf(line.expression);

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
            // Flexible zone: the scene, sized to what is left (hidden below 96 dp, never overflowing).
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: LayoutBuilder(
                  builder: (context, box) {
                    if (box.maxHeight < 96) {
                      return Align(
                        alignment: Alignment.centerLeft,
                        child: MeloWidget(state: meloState, courseTrackId: appState.activeTrackId, size: 44),
                      );
                    }
                    final badge = (box.maxHeight * 0.32).clamp(48.0, 84.0);
                    return AnimatedSceneWidget(
                      sceneId: sceneId,
                      title: sceneTitle(l10n, sceneId),
                      height: box.maxHeight,
                      showTimeToggle: false,
                      child: Stack(
                        children: [
                          Center(
                            child: CharacterBadge(name: learnerTurn ? l10n.you : line.speakerName, speaking: _speaking && !learnerTurn, size: badge),
                          ),
                          Positioned(
                            left: 8,
                            bottom: 6,
                            child: MeloWidget(state: meloState, courseTrackId: appState.activeTrackId, size: (badge * 0.7).clamp(36.0, 60.0)),
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
            ),
            const SizedBox(height: 12),
            // The line: who says it, target text (+ romanization), meaning, and the note when there is one.
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Container(
                key: ValueKey(index),
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: colors.surface,
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: learnerTurn ? accent.primary.withValues(alpha: 0.6) : colors.border),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      learnerTurn ? l10n.sceneYourLine : line.speakerName,
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.4,
                        color: learnerTurn ? accent.primaryText : colors.textMuted,
                      ),
                    ),
                    const SizedBox(height: 6),
                    SizedBox(
                      width: double.infinity,
                      child: TargetText(expression: line.expression, track: plan.track),
                    ),
                    const SizedBox(height: 6),
                    Text(plan.meaningOf(line.expression), style: TextStyle(fontSize: 15, color: colors.textSecondary)),
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
                      ),
                    ],
                  ],
                ),
              ).withMotion(context, (a) => a.fadeIn(duration: 260.ms).slideY(begin: 0.08, end: 0, duration: 260.ms)),
            ),
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: LearnPrimaryButton(
                label: learnerTurn ? l10n.sceneISaidIt : (isLast ? l10n.sceneLearnPhrases : l10n.next),
                icon: LucideIcons.chevronRight,
                onPressed: () => _next(plan),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
