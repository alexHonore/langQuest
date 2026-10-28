import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../core/services/app_state.dart';
import '../../core/services/speech_service.dart';
import '../../core/theme/accents.dart';
import '../../core/theme/colors.dart';
import '../../core/theme/glass.dart';
import '../learn/learn_content.dart';
import '../learn/learn_widgets.dart';
import '../mascot/melo_model.dart';
import '../mascot/melo_widget.dart';
import '../scenes/animated_scene.dart';

enum LessonPhase {
  listen, // 1. The character speaks (a line from the scene the learner already met)
  anticipate, // 2. Pick the reply that was taught
  speak, // 3. Shadow the reply out loud (no recording, no score)
  compare, // 4. Model line again + the phrases used
  completed, // 5. Celebration
}

/// The Mission stop of a mission node (N2). Since the learn path (L1 + L3) the mission uses the same
/// plan as the Learn stop, so it only asks for what was taught. This prototype has no recorder: the
/// learner shadows the model line out loud; nothing is measured, so no level, waveform or score is shown
/// (pronunciation honesty, ADR-006).
class MissionPlayerScreen extends ConsumerStatefulWidget {
  final String missionId;

  const MissionPlayerScreen({super.key, required this.missionId});

  @override
  ConsumerState<MissionPlayerScreen> createState() => _MissionPlayerScreenState();
}

class _MissionPlayerScreenState extends ConsumerState<MissionPlayerScreen> {
  LessonPhase _phase = LessonPhase.listen;
  int? _selectedOption;
  late final SpeechService _speech;

  MissionScript get _script => missionScriptFor(widget.missionId) ?? missionScriptFor(LearnContent.plans.first.missionId)!;
  MissionLearnPlan get _plan => LearnContent.forMission(widget.missionId) ?? LearnContent.plans.first;

  @override
  void initState() {
    super.initState();
    _speech = ref.read(speechServiceProvider);
    WidgetsBinding.instance.addPostFrameCallback((_) => _say(_script.characterLine.text));
  }

  @override
  void dispose() {
    _speech.stop();
    super.dispose();
  }

  Future<void> _say(String text) async {
    final locale = _plan.voiceLocale;
    if (await ref.read(voiceAvailableProvider(locale).future) && mounted) {
      await _speech.speak(text, locale: locale);
    }
  }

  void _finishMission() {
    ref.read(appStateProvider.notifier).completeMission(widget.missionId);
    setState(() => _phase = LessonPhase.completed);
  }

  @override
  Widget build(BuildContext context) {
    final appState = ref.watch(appStateProvider);
    final accent = appState.accent;
    final colors = appState.colors;
    final mission = appState.missions.firstWhere(
      (m) => m.id == widget.missionId,
      orElse: () => appState.missions.first,
    );

    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: Column(
          children: [
            // Top bar: close + one segment per phase
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              child: Row(
                children: [
                  IconButton(
                    icon: const Icon(LucideIcons.x, color: Colors.white70),
                    tooltip: 'Close',
                    onPressed: () => context.pop(),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Row(
                      children: List.generate(4, (index) {
                        final isDone = _phase.index > index;
                        final isCurrent = _phase.index == index;
                        return Expanded(
                          child: Container(
                            height: 4.5,
                            margin: const EdgeInsets.symmetric(horizontal: 3),
                            decoration: BoxDecoration(
                              color: isDone ? colors.success : isCurrent ? accent.primary : Colors.white12,
                              borderRadius: BorderRadius.circular(3),
                            ),
                          ),
                        );
                      }),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(color: accent.primarySoft, borderRadius: BorderRadius.circular(8)),
                    child: Text('${mission.minutes} min', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: accent.primaryText)),
                  ),
                ],
              ),
            ),
            // The mission's own scene (café, street, transit…), not always the café.
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 18),
              child: AnimatedSceneWidget(sceneId: sceneIdFromName(mission.sceneId), height: 150, showTimeToggle: false),
            ),
            const SizedBox(height: 14),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: _buildPhaseContent(accent, colors),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _phaseLabel(String text, IconData icon, CourseAccent accent) => Row(children: [
        Icon(icon, size: 16, color: accent.primaryText),
        const SizedBox(width: 6),
        Text(text, style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, letterSpacing: 1.1, color: accent.primaryText)),
      ]);

  Widget _buildPhaseContent(CourseAccent accent, LangQuestColors colors) {
    final script = _script;
    final plan = _plan;
    switch (_phase) {
      case LessonPhase.listen:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _phaseLabel('1. LISTEN', LucideIcons.volume2, accent),
            const SizedBox(height: 14),
            GlassContainer(
              level: GlassLevel.level2,
              radius: 20,
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    CharacterBadge(name: script.speaker, speaking: false, size: 36, showName: false),
                    const SizedBox(width: 12),
                    Text(script.speaker, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: colors.textPrimary)),
                  ]),
                  const SizedBox(height: 14),
                  Text('« ${script.characterLine.text} »', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: Colors.white, height: 1.4)),
                  const SizedBox(height: 4),
                  Text(script.characterLine.pronunciation, style: TextStyle(fontSize: 12.5, fontStyle: FontStyle.italic, color: colors.textMuted)),
                  const SizedBox(height: 6),
                  Text('“${script.characterLine.meaning}”', style: TextStyle(fontSize: 13, color: colors.textSecondary)),
                  const SizedBox(height: 10),
                  ListenButtons(text: script.characterLine.text, locale: plan.voiceLocale, compact: true),
                ],
              ),
            ),
            const Spacer(),
            _buildActionButton(
              label: 'Continue',
              icon: LucideIcons.arrowRight,
              accent: accent,
              onTap: () => setState(() => _phase = LessonPhase.anticipate),
            ),
            const SizedBox(height: 20),
          ],
        );

      case LessonPhase.anticipate:
        final chosen = _selectedOption;
        final correct = chosen != null && chosen == script.answerIndex;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _phaseLabel('2. YOUR REPLY', LucideIcons.helpCircle, accent),
            const SizedBox(height: 8),
            Text('${script.speaker} said: “${script.characterLine.meaning}” What do you answer?',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: colors.textPrimary)),
            const SizedBox(height: 14),
            ...List.generate(script.options.length, (i) {
              final isChosen = chosen == i;
              final wrong = isChosen && !correct;
              final border = wrong ? colors.error : isChosen ? colors.success : Colors.white12;
              return Semantics(
                button: true,
                selected: isChosen,
                label: script.options[i],
                child: GestureDetector(
                  onTap: () => setState(() => _selectedOption = i),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    margin: const EdgeInsets.only(bottom: 10),
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: wrong ? colors.errorSoft : isChosen ? colors.successSoft : colors.elevated,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: border, width: isChosen ? 2.0 : 1.0),
                    ),
                    child: Row(children: [
                      Icon(isChosen ? (wrong ? LucideIcons.x : LucideIcons.check) : LucideIcons.circle, size: 18, color: isChosen ? border : Colors.white30),
                      const SizedBox(width: 12),
                      Expanded(child: Text(script.options[i], style: TextStyle(fontSize: 15, fontWeight: isChosen ? FontWeight.w700 : FontWeight.w500, color: colors.textPrimary))),
                    ]),
                  ),
                ),
              );
            }),
            if (chosen != null && !correct)
              Text('Not quite — think of what you practised with ${script.speaker}.', style: TextStyle(fontSize: 13, color: colors.error)),
            const Spacer(),
            _buildActionButton(
              label: 'Say it',
              icon: LucideIcons.mic,
              accent: accent,
              enabled: correct,
              onTap: () {
                setState(() => _phase = LessonPhase.speak);
                _say(script.answer.text);
              },
            ),
            const SizedBox(height: 20),
          ],
        );

      case LessonPhase.speak:
        return Column(
          children: [
            _phaseLabel('3. SAY IT OUT LOUD', LucideIcons.mic, accent),
            const SizedBox(height: 18),
            Text('« ${script.answer.text} »', textAlign: TextAlign.center, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: Colors.white, height: 1.35)),
            const SizedBox(height: 6),
            Text(script.answer.pronunciation, textAlign: TextAlign.center, style: TextStyle(fontSize: 13, fontStyle: FontStyle.italic, color: colors.textMuted)),
            const SizedBox(height: 18),
            ListenButtons(text: script.answer.text, locale: plan.voiceLocale),
            const SizedBox(height: 18),
            MeloWidget(state: MeloState.curious, courseTrackId: ref.watch(appStateProvider).activeTrackId, size: 64),
            const Spacer(),
            _buildActionButton(
              label: 'I said it',
              icon: LucideIcons.check,
              accent: accent,
              onTap: () => setState(() => _phase = LessonPhase.compare),
            ),
            const SizedBox(height: 20),
          ],
        );

      case LessonPhase.compare:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _phaseLabel('4. WHAT YOU USED', LucideIcons.bookOpen, accent),
            const SizedBox(height: 14),
            GlassContainer(
              level: GlassLevel.level2,
              radius: 20,
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('« ${script.answer.text} »', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: Colors.white)),
                  const SizedBox(height: 4),
                  Text(script.answer.meaning, style: TextStyle(fontSize: 13, color: colors.textSecondary)),
                  const SizedBox(height: 12),
                  Wrap(spacing: 6, runSpacing: 6, children: [
                    for (final p in plan.phrases)
                      if (script.answer.text.toLowerCase().contains(p.text.replaceAll('…', '').trim().toLowerCase()))
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                          decoration: BoxDecoration(color: colors.successSoft, borderRadius: BorderRadius.circular(8), border: Border.all(color: colors.success, width: 0.8)),
                          child: Text('${p.text} · ${p.meaning}', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: colors.success)),
                        ),
                  ]),
                  const SizedBox(height: 10),
                  ListenButtons(text: script.answer.text, locale: plan.voiceLocale, compact: true),
                ],
              ),
            ),
            const Spacer(),
            _buildActionButton(label: 'Complete mission (+25 XP)', icon: LucideIcons.sparkles, accent: accent, onTap: _finishMission),
            const SizedBox(height: 20),
          ],
        );

      case LessonPhase.completed:
        return Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              MeloWidget(state: MeloState.celebrate, speech: 'Magnifique ! Next: talk freely with ${script.speaker}.', size: 110),
              const SizedBox(height: 24),
              const Text('Mission completed!', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: Colors.white)),
              const SizedBox(height: 8),
              Text('+25 XP', style: TextStyle(fontSize: 14, color: accent.primaryText)),
              const SizedBox(height: 36),
              _buildActionButton(label: 'Back to the mission path', icon: LucideIcons.check, accent: accent, onTap: () => context.pop()),
            ],
          ),
        );
    }
  }

  Widget _buildActionButton({
    required String label,
    required IconData icon,
    required CourseAccent accent,
    required VoidCallback onTap,
    bool enabled = true,
  }) {
    return Semantics(
      button: true,
      enabled: enabled,
      label: label,
      excludeSemantics: true,
      child: GestureDetector(
        onTap: enabled ? onTap : null,
        child: AnimatedOpacity(
          duration: const Duration(milliseconds: 200),
          opacity: enabled ? 1.0 : 0.45,
          child: Container(
            width: double.infinity,
            height: 52,
            decoration: BoxDecoration(
              gradient: LinearGradient(colors: [accent.primary, accent.primaryStrong]),
              borderRadius: BorderRadius.circular(16),
              boxShadow: enabled ? [BoxShadow(color: accent.primary.withValues(alpha: 0.4), blurRadius: 18, spreadRadius: 2)] : null,
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(icon, size: 18, color: Colors.white),
                const SizedBox(width: 8),
                Text(label, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Colors.white)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
