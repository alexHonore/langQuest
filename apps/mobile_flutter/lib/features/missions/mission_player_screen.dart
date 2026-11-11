import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../navigation/nav.dart';
import '../../core/backend/speech_check.dart';
import '../call/call_screen.dart';
import '../../core/layout/motion.dart';
import '../../core/learning/srs.dart';
import '../../core/services/app_state.dart';
import '../../core/services/learner_state.dart';
import '../../core/services/speech_service.dart';
import '../../l10n/l10n.dart';
import '../learn/learn_content.dart';
import '../learn/learn_providers.dart';
import '../learn/learn_widgets.dart';
import '../learn/record_take.dart';
import '../mascot/melo_model.dart';
import '../mascot/melo_widget.dart';
import '../scenes/animated_scene.dart';

enum _Phase { exchange, recap, completed }

/// The Mission stop of a mission node (N2). Every exchange asks only for a line the Learn stop taught: the
/// character's cue (or the meaning, when the learner speaks first), the reply chosen among three taught phrases,
/// then said out loud — where the device can record, the learner can record it and hear their take next to the
/// reference voice. For a signed-in learner whose course the server can check, the take is checked: was the reply
/// understood? (Meaning only, never a pronunciation score: ADR-006.) Completing it credits the mission once and puts
/// each phrase used into spaced review: good when chosen right the first time and, if it was checked, understood the
/// first time; otherwise hard.
class MissionPlayerScreen extends ConsumerStatefulWidget {
  final String missionKey;

  const MissionPlayerScreen({super.key, required this.missionKey});

  @override
  ConsumerState<MissionPlayerScreen> createState() => _MissionPlayerScreenState();
}

class _MissionPlayerScreenState extends ConsumerState<MissionPlayerScreen> {
  _Phase _phase = _Phase.exchange;
  int _exchange = 0;
  int? _selected;
  bool _answered = false;
  bool _speaking = false;
  int _utterance = 0;
  final Map<String, bool> _firstTry = {};

  /// Per reply, whether the server understood its first checked take (a take it could not judge does not count).
  final Map<String, bool> _spoken = {};

  /// The server's latest verdict on the current exchange.
  SpeechVerdict? _verdict;
  late final SpeechService _speech;
  late final bool _wasCompleted;
  int _newReviewCards = 0;

  @override
  void initState() {
    super.initState();
    _speech = ref.read(speechServiceProvider);
    _wasCompleted = ref.read(appStateProvider).progress.isMissionCompleted(widget.missionKey);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(appStateProvider.notifier).missionOpened(widget.missionKey);
      _sayCue();
    });
  }

  @override
  void dispose() {
    _speech.stop();
    super.dispose();
  }

  Future<void> _say(String text) async {
    final locale = ref.read(learnPlanProvider(widget.missionKey))?.voiceLocale;
    if (locale == null || !await ref.read(voiceAvailableProvider(locale).future) || !mounted) return;
    final token = ++_utterance;
    setState(() => _speaking = true);
    await _speech.speak(text, locale: locale);
    if (mounted && token == _utterance) setState(() => _speaking = false);
  }

  void _sayCue() {
    final plan = ref.read(learnPlanProvider(widget.missionKey));
    if (plan == null || _exchange >= plan.exchanges.length) return;
    final cue = plan.exchanges[_exchange].cue;
    if (cue != null) _say(cue.text);
  }

  void _choose(MissionExchange exchange, int index) {
    if (_answered) return;
    final correct = index == exchange.answerIndex;
    setState(() {
      _selected = index;
      _firstTry.putIfAbsent(exchange.answer.id, () => correct);
      _answered = correct;
    });
    if (correct) _say(exchange.answer.text);
  }

  void _nextExchange(MissionLearnPlan plan) {
    _utterance++;
    _speech.stop();
    setState(() {
      _selected = null;
      _answered = false;
      _speaking = false;
      _verdict = null;
      if (_exchange < plan.exchanges.length - 1) {
        _exchange++;
      } else {
        _phase = _Phase.recap;
      }
    });
    if (_phase == _Phase.exchange) _sayCue();
  }

  void _onVerdict(MissionExchange exchange, SpeechVerdict verdict) {
    if (verdict.kind == SpeechVerdictKind.understood || verdict.kind == SpeechVerdictKind.notUnderstood) {
      _spoken.putIfAbsent(exchange.answer.id, () => verdict.understood);
    }
    setState(() => _verdict = verdict);
  }

  void _complete(MissionLearnPlan plan) {
    final before = ref.read(appStateProvider).progress.cards.length;
    ref.read(appStateProvider.notifier).completeMission(widget.missionKey, {
      for (final x in plan.exchanges) x.answer.id: (_firstTry[x.answer.id] ?? true) && (_spoken[x.answer.id] ?? true) ? ReviewRating.good : ReviewRating.hard,
    });
    setState(() {
      _newReviewCards = ref.read(appStateProvider).progress.cards.length - before;
      _phase = _Phase.completed;
    });
  }

  @override
  Widget build(BuildContext context) {
    final plan = ref.watch(learnPlanProvider(widget.missionKey));
    if (plan == null || plan.exchanges.isEmpty) return const MissionUnavailable();
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final sceneId = sceneIdForSituation(plan.mission.situation);
    final segments = plan.exchanges.length + 1;
    final current = switch (_phase) {
      _Phase.exchange => _exchange,
      _Phase.recap => plan.exchanges.length,
      _Phase.completed => segments,
    };

    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 4, 16, 4),
              child: Row(
                children: [
                  IconButton(
                    icon: Icon(LucideIcons.x, color: colors.textSecondary),
                    tooltip: l10n.close,
                    onPressed: () => context.popOrHome(),
                  ),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          plan.mission.titleIn(plan.source) ?? '',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: colors.textPrimary),
                        ),
                        const SizedBox(height: 6),
                        Semantics(
                          label: l10n.stepOf((current + 1).clamp(1, segments), segments),
                          child: Row(
                            children: List.generate(
                              segments,
                              (i) => Expanded(
                                child: Container(
                                  height: 4,
                                  margin: const EdgeInsets.symmetric(horizontal: 2),
                                  decoration: BoxDecoration(
                                    color: i < current ? colors.success : (i == current ? accent.primary : colors.border),
                                    borderRadius: BorderRadius.circular(2),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            if (_phase != _Phase.completed)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                child: LayoutBuilder(
                  builder: (context, box) {
                    final height = (MediaQuery.sizeOf(context).height * 0.17).clamp(96.0, 150.0);
                    return AnimatedSceneWidget(
                      sceneId: sceneId,
                      title: sceneTitle(l10n, sceneId),
                      height: height,
                      showTimeToggle: false,
                      child: Center(
                        child: CharacterBadge(
                          name: plan.characterName,
                          speaking: _speaking && _phase == _Phase.exchange && !_answered,
                          size: (height * 0.45).clamp(40.0, 64.0),
                        ),
                      ),
                    );
                  },
                ),
              ),
            const SizedBox(height: 12),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: switch (_phase) {
                  _Phase.exchange => _exchangeView(plan, plan.exchanges[_exchange]),
                  _Phase.recap => _recapView(plan),
                  _Phase.completed => _completedView(plan),
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _exchangeView(MissionLearnPlan plan, MissionExchange exchange) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final cue = exchange.cue;
    final wrong = _selected != null && _selected != exchange.answerIndex;

    final prompt = Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: colors.border),
      ),
      child: cue != null
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.missionCue(plan.characterName),
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.4, color: colors.textMuted),
                ),
                const SizedBox(height: 6),
                SizedBox(
                  width: double.infinity,
                  child: TargetText(expression: cue, track: plan.track, fontSize: 19),
                ),
                const SizedBox(height: 4),
                Text(plan.meaningOf(cue), style: TextStyle(fontSize: 14, color: colors.textSecondary)),
                const SizedBox(height: 8),
                ListenButtons(text: cue.text, locale: plan.voiceLocale, compact: true),
              ],
            )
          : Text(
              l10n.missionHowDoYouSay(plan.promptMeaningOf(exchange.answer)),
              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: colors.textPrimary),
            ),
    );

    if (_answered) {
      // Say it: the chosen (correct) reply, big, with its meaning and the device voice when there is one.
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(LucideIcons.mic, size: 16, color: accent.primaryText),
              const SizedBox(width: 6),
              Text(
                l10n.missionSayIt,
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, letterSpacing: 0.6, color: accent.primaryText),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Expanded(
            child: SingleChildScrollView(
              child: Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: colors.successSoft,
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: colors.success, width: 1.5),
                ),
                child: Column(
                  children: [
                    TargetText(expression: exchange.answer, track: plan.track, fontSize: 24, textAlign: TextAlign.center),
                    const SizedBox(height: 8),
                    Text(
                      plan.meaningOf(exchange.answer),
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 15, color: colors.textSecondary),
                    ),
                    const SizedBox(height: 12),
                    ListenButtons(text: exchange.answer.text, locale: plan.voiceLocale),
                    const SizedBox(height: 10),
                    RecordTake(
                      key: ValueKey('take-$_exchange'),
                      voiceLocale: plan.voiceLocale,
                      centered: true,
                      check: SpeechTarget(expressionId: exchange.answer.id, chapterKey: plan.mission.chapterKey, missionKey: plan.mission.key),
                      onVerdict: (verdict) => _onVerdict(exchange, verdict),
                    ),
                    const SizedBox(height: 12),
                    MeloWidget(
                      state: _verdict == null || _verdict!.understood ? MeloState.happy : MeloState.thinking,
                      courseTrackId: appState.activeTrackId,
                      size: 56,
                    ),
                  ],
                ),
              ).withMotion(context, (a) => a.fadeIn(duration: 220.ms).scale(begin: const Offset(0.97, 0.97), duration: 220.ms)),
            ),
          ),
          const SizedBox(height: 10),
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: LearnPrimaryButton(label: l10n.sceneISaidIt, icon: LucideIcons.check, onPressed: () => _nextExchange(plan)),
          ),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        prompt,
        const SizedBox(height: 12),
        if (cue != null)
          Text(
            l10n.missionWhatDoYouAnswer,
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: colors.textPrimary),
          ),
        if (cue != null) const SizedBox(height: 8),
        Expanded(
          child: SingleChildScrollView(
            child: Column(
              children: [
                for (var i = 0; i < exchange.options.length; i++)
                  _OptionTile(plan: plan, optionIndex: i, exchange: exchange, selected: _selected == i, onTap: () => _choose(exchange, i)),
                if (wrong)
                  Text(l10n.missionWrong, style: TextStyle(fontSize: 13.5, color: colors.error)).withMotion(context, (a) => a.fadeIn(duration: 200.ms)),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
      ],
    );
  }

  Widget _recapView(MissionLearnPlan plan) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    final l10n = context.l10n;
    final answers = <String, MissionExchange>{for (final x in plan.exchanges) x.answer.id: x};
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          l10n.missionRecapTitle,
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: colors.textPrimary),
        ),
        const SizedBox(height: 10),
        Expanded(
          child: ListView(
            children: [
              for (final x in answers.values)
                Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: colors.surface,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: colors.border),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            TargetText(expression: x.answer, track: plan.track, fontSize: 17),
                            const SizedBox(height: 2),
                            Text(plan.meaningOf(x.answer), style: TextStyle(fontSize: 13, color: colors.textSecondary)),
                          ],
                        ),
                      ),
                      ListenButtons(text: x.answer.text, locale: plan.voiceLocale, compact: true),
                    ],
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: LearnPrimaryButton(
            label: _wasCompleted ? l10n.missionComplete : '${l10n.missionComplete} (${l10n.xpGain(XpAmounts.missionCompleted)})',
            icon: LucideIcons.sparkles,
            onPressed: () => _complete(plan),
          ),
        ),
      ],
    );
  }

  Widget _completedView(MissionLearnPlan plan) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final course = appState.activeCourse;
    final next = course == null ? null : appState.nextMission(course);
    return Center(
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            MeloWidget(state: MeloState.celebrate, courseTrackId: appState.activeTrackId, size: 110),
            const SizedBox(height: 20),
            Text(
              l10n.missionCompleted,
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: colors.textPrimary),
            ),
            const SizedBox(height: 8),
            Text(
              _wasCompleted ? l10n.missionXpOnce : l10n.xpGain(XpAmounts.missionCompleted),
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: accent.primaryText),
            ),
            if (_newReviewCards > 0) ...[
              const SizedBox(height: 6),
              Text(
                l10n.missionJoinReview(_newReviewCards),
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 14, color: colors.textSecondary),
              ),
            ],
            if (_spoken.isNotEmpty) ...[
              const SizedBox(height: 6),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(LucideIcons.mic, size: 15, color: colors.success),
                  const SizedBox(width: 6),
                  Flexible(
                    child: Text(
                      l10n.missionSpokenSummary(_spoken.values.where((understood) => understood).length, _spoken.length),
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 14, color: colors.textSecondary),
                    ),
                  ),
                ],
              ),
            ],
            const SizedBox(height: 28),
            if (next != null && next.key != widget.missionKey)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: LearnPrimaryButton(
                  label: l10n.missionNext,
                  icon: LucideIcons.chevronRight,
                  onPressed: () => context.pushReplacement('/path/${next.key}'),
                ),
              ),
            if (ref.watch(liveCallCourseProvider) != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: OutlinedButton.icon(
                  onPressed: () => context.pushReplacement('/call/${widget.missionKey}'),
                  icon: const Icon(LucideIcons.phoneCall, size: 18),
                  label: Text(l10n.missionTryLiveCall),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 48),
                    foregroundColor: accent.primaryText,
                    side: BorderSide(color: accent.primary),
                  ),
                ),
              ),
            TextButton(
              onPressed: () => context.popOrHome(),
              child: Text(
                l10n.missionBackToPath,
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: accent.primaryText),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _OptionTile extends ConsumerWidget {
  final MissionLearnPlan plan;
  final MissionExchange exchange;
  final int optionIndex;
  final bool selected;
  final VoidCallback onTap;

  const _OptionTile({required this.plan, required this.exchange, required this.optionIndex, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    final option = exchange.options[optionIndex];
    final wrong = selected && optionIndex != exchange.answerIndex;
    final border = wrong ? colors.error : (selected ? colors.success : colors.border);
    return Semantics(
      button: true,
      selected: selected,
      label: option.romanization == null ? option.text : '${option.text}, ${option.romanization}',
      localeForSubtree: contentLanguageOf(plan.track),
      excludeSemantics: true,
      child: Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            width: double.infinity,
            constraints: const BoxConstraints(minHeight: 56),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color: wrong ? colors.errorSoft : (selected ? colors.successSoft : colors.surface),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: border, width: selected ? 2 : 1),
            ),
            child: Row(
              children: [
                Icon(selected ? (wrong ? LucideIcons.x : LucideIcons.check) : LucideIcons.circle, size: 18, color: selected ? border : colors.textMuted),
                const SizedBox(width: 12),
                Expanded(
                  child: TargetText(expression: option, track: plan.track, fontSize: 17),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
