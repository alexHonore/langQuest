import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../core/services/app_state.dart';
import '../../core/services/speech_service.dart';
import '../mascot/melo_model.dart';
import '../mascot/melo_widget.dart';
import '../scenes/animated_scene.dart';
import 'learn_content.dart';
import 'learn_widgets.dart';

/// L1 — "watch it happen": the mission's scene plays line by line. The character speaks (device voice,
/// labelled synthetic), the line shows in target text + pronunciation + meaning, and on the learner's
/// own lines the learner shadows it out loud. Nothing is scored and nothing is asked yet.
/// Fits the screen: the scene takes the height left after the line card and the button.
class SceneLessonScreen extends ConsumerStatefulWidget {
  final String missionId;
  const SceneLessonScreen({super.key, required this.missionId});

  @override
  ConsumerState<SceneLessonScreen> createState() => _SceneLessonScreenState();
}

class _SceneLessonScreenState extends ConsumerState<SceneLessonScreen> {
  int _index = 0;
  bool _speaking = false;
  late final SpeechService _speech;

  MissionLearnPlan get _plan => LearnContent.forMission(widget.missionId)!;

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
    final plan = _plan;
    final available = await ref.read(voiceAvailableProvider(plan.voiceLocale).future);
    if (!available || !mounted) return;
    setState(() => _speaking = true);
    await _speech.speak(plan.sceneLines[_index].text, locale: plan.voiceLocale, slow: slow);
    if (mounted) setState(() => _speaking = false);
  }

  void _next() {
    final plan = _plan;
    if (_index < plan.sceneLines.length - 1) {
      setState(() => _index++);
      _speakCurrent();
    } else {
      _speech.stop();
      context.pushReplacement('/learn/${widget.missionId}/cards');
    }
  }

  @override
  Widget build(BuildContext context) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final plan = _plan;
    final mission = appState.missions.firstWhere((m) => m.id == widget.missionId, orElse: () => appState.missions.first);
    final line = plan.sceneLines[_index];
    final hasVoice = ref.watch(voiceAvailableProvider(plan.voiceLocale)).asData?.value ?? false;
    final learnerTurn = line.byLearner;
    final meloState = _speaking ? MeloState.curious : (learnerTurn ? MeloState.welcome : MeloState.companion);

    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: Column(
          children: [
            LearnTopBar(title: 'Learn · ${mission.title}', step: _index + 1, total: plan.sceneLines.length, onClose: () => context.pop()),
            // Flexible zone: the scene, sized to what is left (hidden below 96 dp, never overflowing).
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: LayoutBuilder(builder: (context, box) {
                  if (box.maxHeight < 96) {
                    return Align(alignment: Alignment.centerLeft, child: MeloWidget(state: meloState, courseTrackId: appState.activeTrackId, size: 44));
                  }
                  final badge = (box.maxHeight * 0.32).clamp(48.0, 84.0);
                  return AnimatedSceneWidget(
                    sceneId: sceneIdFromName(mission.sceneId),
                    height: box.maxHeight,
                    showTimeToggle: false,
                    child: Stack(children: [
                      Center(child: CharacterBadge(name: learnerTurn ? 'You' : line.speaker, speaking: _speaking && !learnerTurn, size: badge)),
                      Positioned(left: 8, bottom: 6, child: MeloWidget(state: meloState, courseTrackId: appState.activeTrackId, size: (badge * 0.7).clamp(36.0, 60.0))),
                      if (hasVoice)
                        Positioned(
                          right: 10,
                          top: 10,
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(color: const Color(0xB30B0913), borderRadius: BorderRadius.circular(10)),
                            child: const Row(mainAxisSize: MainAxisSize.min, children: [
                              Icon(LucideIcons.audioLines, size: 12, color: Colors.white70),
                              SizedBox(width: 4),
                              Text('Synthetic voice', style: TextStyle(fontSize: 11, color: Colors.white70)),
                            ]),
                          ),
                        ),
                    ]),
                  );
                }),
              ),
            ),
            const SizedBox(height: 12),
            // The line: who says it, target text, pronunciation, meaning.
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Container(
                key: ValueKey(_index),
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: colors.surface,
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: learnerTurn ? accent.primary.withValues(alpha: 0.6) : colors.border),
                ),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(learnerTurn ? 'Your line — say it out loud' : line.speaker,
                      style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.4, color: learnerTurn ? accent.primaryText : colors.textMuted)),
                  const SizedBox(height: 6),
                  Text(line.text, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, height: 1.25, color: colors.textPrimary)),
                  const SizedBox(height: 4),
                  Text(line.pronunciation, style: TextStyle(fontSize: 13, fontStyle: FontStyle.italic, color: colors.textMuted)),
                  const SizedBox(height: 6),
                  Text(line.meaning, style: TextStyle(fontSize: 15, color: colors.textSecondary)),
                  const SizedBox(height: 10),
                  ListenButtons(text: line.text, locale: plan.voiceLocale, compact: true),
                ]),
              ).animate().fadeIn(duration: 260.ms).slideY(begin: 0.08, end: 0, duration: 260.ms),
            ),
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: LearnPrimaryButton(
                label: learnerTurn ? 'I said it' : (_index == plan.sceneLines.length - 1 ? 'Learn the phrases' : 'Next'),
                icon: LucideIcons.chevronRight,
                onPressed: _next,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
