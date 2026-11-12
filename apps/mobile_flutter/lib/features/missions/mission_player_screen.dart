import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../navigation/nav.dart';
import '../../core/backend/narrator.dart';
import '../../core/backend/server_voice.dart';
import '../../core/backend/speech_check.dart';
import '../../core/content/content_models.dart';
import '../call/call_screen.dart';
import '../games/game_pool.dart';
import '../../core/layout/celebration.dart';
import '../../core/layout/motion.dart';
import '../../core/learning/srs.dart';
import '../../core/services/app_state.dart';
import '../../core/theme/typography.dart';
import '../../core/services/learner_state.dart';
import '../../core/services/speech_service.dart';
import '../../l10n/l10n.dart';
import '../learn/exercise_widgets.dart';
import '../learn/learn_content.dart';
import '../learn/learn_providers.dart';
import '../learn/learn_widgets.dart';
import '../learn/record_take.dart';
import '../mascot/melo_model.dart';
import '../mascot/melo_widget.dart';
import '../scenes/animated_scene.dart';

enum _Phase { exchange, recap, completed }

/// The Mission stop of a mission node (N2), played as the conversation it is: the lines exchanged so far stay above
/// as a thread, the character's next line arrives in a bubble, and the learner's reply joins it once given. Every
/// exchange asks only for a line the Learn stop taught: the
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

  /// The current reply was given out loud and understood (no option was chosen).
  bool _answeredByVoice = false;

  /// The chosen reply has to be said (with a microphone) before the next exchange.
  final _sayStep = SpeakingStep();
  late final SpeechService _speech;
  late final bool _wasCompleted;
  int _newReviewCards = 0;

  /// The conversation's thread: it follows the latest line.
  final _thread = ScrollController();

  @override
  void initState() {
    super.initState();
    _speech = ref.read(speechServiceProvider);
    _wasCompleted = ref.read(appStateProvider).progress.isMissionCompleted(widget.missionKey);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(appStateProvider.notifier).missionOpened(widget.missionKey);
      _introduce();
    });
  }

  @override
  void dispose() {
    _speech.stop();
    _thread.dispose();
    super.dispose();
  }

  /// Brings the newest line of the thread into view (after the frame that added it).
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

  /// Says [line] in the course's voice (the server's AI voice signed in, else the device's), interrupting the
  /// narration. Part of an introduction when [token] is given; a new utterance otherwise.
  Future<void> _say(Expression line, {int? token}) async {
    final plan = ref.read(learnPlanProvider(widget.missionKey));
    if (plan == null) return;
    final id = token ?? ++_utterance;
    if (token == null) ref.read(narratorProvider)?.stop();
    final voice = await ref.read(lineVoiceProvider(plan.voiceLocale).future);
    if (!voice.available || !mounted || id != _utterance) return;
    setState(() => _speaking = true);
    await voice.say(text: line.text, expressionId: line.id);
    if (mounted && id == _utterance) setState(() => _speaking = false);
  }

  /// The exchange read aloud as it appears: on the first, the scene's context; then "Karim says", the cue in the
  /// course's voice and "What do you answer?" — or "How do you say “…”?" when the learner speaks first. Without
  /// narration (Settings › Display, or no voice for the instruction language), only the cue is said.
  Future<void> _introduce({bool asked = false}) async {
    final plan = ref.read(learnPlanProvider(widget.missionKey));
    if (plan == null || _exchange >= plan.exchanges.length) return;
    final token = ++_utterance;
    bool live() => mounted && token == _utterance && _phase == _Phase.exchange && !_answered;
    final exchange = plan.exchanges[_exchange];
    final cue = exchange.cue;
    final read = readAloudFor(ref, asked: asked);
    final note = _exchange == 0 ? plan.mission.sceneNoteIn(plan.source) : null;
    if (read != null) {
      final question = cue == null ? read.words.missionHowDoYouSay(plan.promptMeaningOf(exchange.answer)) : read.words.missionWhatDoYouAnswer;
      read.narrator.prepare(question);
      if (note != null) {
        await read.narrator.say(note);
        if (!live()) return;
      }
      if (cue == null) {
        await read.narrator.say(question);
        return;
      }
      await read.narrator.say(read.words.missionCue(plan.characterName));
      if (!live()) return;
      await _say(cue, token: token);
      if (!live()) return;
      await read.narrator.say(question);
      return;
    }
    if (cue != null) await _say(cue, token: token);
  }

  void _choose(MissionExchange exchange, int index) {
    if (_answered) return;
    final correct = index == exchange.answerIndex;
    setState(() {
      _selected = index;
      _firstTry.putIfAbsent(exchange.answer.id, () => correct);
      _answered = correct;
    });
    _followThread();
    if (correct) _say(exchange.answer);
  }

  void _nextExchange(MissionLearnPlan plan) {
    _utterance++;
    _speech.stop();
    _sayStep.reset();
    setState(() {
      _selected = null;
      _answered = false;
      _speaking = false;
      _verdict = null;
      _answeredByVoice = false;
      if (_exchange < plan.exchanges.length - 1) {
        _exchange++;
      } else {
        _phase = _Phase.recap;
      }
    });
    _followThread();
    if (_phase == _Phase.exchange) _introduce();
  }

  /// The learner answered out loud before choosing: understood is the right reply given unaided (first try, good);
  /// not understood keeps the options, and the reply goes to review as hard.
  void _onSpokenAnswer(MissionExchange exchange, SpeechVerdict verdict) {
    if (_answered) return;
    if (verdict.kind == SpeechVerdictKind.understood) {
      _firstTry.putIfAbsent(exchange.answer.id, () => true);
      _spoken.putIfAbsent(exchange.answer.id, () => true);
      setState(() {
        _answered = true;
        _answeredByVoice = true;
        _selected = exchange.answerIndex;
        _verdict = verdict;
      });
      _followThread();
      _say(exchange.answer);
    } else if (verdict.kind == SpeechVerdictKind.notUnderstood) {
      _spoken.putIfAbsent(exchange.answer.id, () => false);
      setState(() => _verdict = verdict);
    }
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
    final l10n = context.l10n;
    final sceneId = sceneIdForMission(plan.mission);
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
            LearnTopBar(
              title: plan.mission.titleIn(plan.source) ?? '',
              step: (current + 1).clamp(1, segments),
              total: segments,
              fraction: current / segments,
              onClose: () => context.popOrHome(),
            ),
            // The place of the conversation, with who the learner is talking to.
            if (_phase == _Phase.exchange)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                child: AnimatedSceneWidget(
                  sceneId: sceneId,
                  title: sceneTitle(l10n, sceneId),
                  height: (MediaQuery.sizeOf(context).height * 0.13).clamp(84.0, 116.0),
                  showTimeToggle: false,
                  child: Align(
                    alignment: AlignmentDirectional.centerEnd,
                    child: Padding(
                      padding: const EdgeInsetsDirectional.only(end: 16),
                      child: CharacterBadge(name: plan.characterName, speaking: _speaking && !_answered, size: 46),
                    ),
                  ),
                ),
              ),
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
    final canAnswerOutLoud = ref.watch(speechCheckerProvider) != null && ref.watch(takeRecorderFactoryProvider) != null;
    // Said out loud already (understood), or waits for a take of the chosen reply.
    final waitingForTake = _answered && !_answeredByVoice && speakingRequired(ref) && !_sayStep.done;

    // Where the conversation happens, then what was exchanged before, as its thread.
    final thread = <Widget>[
      if (plan.mission.sceneNoteIn(plan.source) case final note?)
        Padding(
          padding: const EdgeInsets.fromLTRB(8, 0, 8, 12),
          child: Text(
            note,
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 13.5, height: 1.4, fontStyle: FontStyle.italic, color: colors.textMuted),
          ),
        ),
      for (final past in plan.exchanges.take(_exchange)) ...[
        if (past.cue case final said?)
          LineBubble(
            expression: said,
            track: plan.track,
            meaning: plan.meaningOf(said),
            byLearner: false,
            speakerName: plan.characterName,
            faded: true,
            fontSize: 16,
          ),
        LineBubble(expression: past.answer, track: plan.track, meaning: plan.meaningOf(past.answer), byLearner: true, faded: true, fontSize: 16),
      ],
    ];

    // The character's line to answer, or what to say when the learner speaks first.
    final Widget prompt = cue != null
        ? LineBubble(
            expression: cue,
            track: plan.track,
            meaning: plan.meaningOf(cue),
            byLearner: false,
            speakerName: l10n.missionCue(plan.characterName),
            speaking: _speaking && !_answered,
            fontSize: 19,
            footer: Row(
              children: [
                Expanded(
                  child: Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: ListenButtons(text: cue.text, expressionId: cue.id, locale: plan.voiceLocale, compact: true),
                  ),
                ),
                ReadAloudButton(onPressed: () => _introduce(asked: true)),
              ],
            ),
          )
        : Container(
            width: double.infinity,
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
            decoration: BoxDecoration(color: colors.surfaceMuted, borderRadius: BorderRadius.circular(18)),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    l10n.missionHowDoYouSay(plan.promptMeaningOf(exchange.answer)),
                    style: TextStyle(fontSize: 17.5, height: 1.3, fontWeight: FontWeight.w600, color: colors.textPrimary),
                  ),
                ),
                ReadAloudButton(onPressed: () => _introduce(asked: true)),
              ],
            ),
          );

    final List<Widget> turn;
    if (_answered) {
      // Say it: the reply, now the learner's own line in the thread, with its meaning and the voice to copy.
      turn = [
        Row(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            Icon(_answeredByVoice ? LucideIcons.circleCheck : LucideIcons.mic, size: 16, color: _answeredByVoice ? colors.success : accent.primaryText),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                _answeredByVoice ? l10n.missionAnsweredOutLoud : l10n.missionSayIt,
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: _answeredByVoice ? colors.success : accent.primaryText),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Container(
          margin: const EdgeInsetsDirectional.only(start: 20),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: accent.primarySoft,
            borderRadius: const BorderRadiusDirectional.only(
              topStart: Radius.circular(22),
              topEnd: Radius.circular(22),
              bottomStart: Radius.circular(22),
              bottomEnd: Radius.circular(6),
            ),
            border: Border.all(color: accent.primary, width: 1.5),
          ),
          child: Column(
            children: [
              TargetText(expression: exchange.answer, track: plan.track, fontSize: 24, textAlign: TextAlign.center),
              const SizedBox(height: 6),
              Text(
                plan.meaningOf(exchange.answer),
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 15, height: 1.3, color: colors.textSecondary),
              ),
              const SizedBox(height: 12),
              ListenButtons(text: exchange.answer.text, expressionId: exchange.answer.id, locale: plan.voiceLocale),
              const SizedBox(height: 10),
              // Said out loud and understood already: what was heard; otherwise, say it now.
              if (_answeredByVoice && _verdict?.heard != null)
                Text(
                  l10n.verdictHeard(_verdict!.heard!),
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 13.5, color: colors.textSecondary),
                )
              else if (!_answeredByVoice)
                RecordTake(
                  key: ValueKey('take-$_exchange'),
                  voiceLocale: plan.voiceLocale,
                  centered: true,
                  check: SpeechTarget(expressionId: exchange.answer.id, chapterKey: plan.mission.chapterKey, missionKey: plan.mission.key),
                  onVerdict: (verdict) => _onVerdict(exchange, verdict),
                  onTake: (outcome) => setState(() => _sayStep.take(outcome)),
                ),
              MeloWidget(
                state: _verdict == null || _verdict!.understood ? MeloState.happy : MeloState.thinking,
                courseTrackId: appState.activeTrackId,
                size: 48,
              ),
            ],
          ),
        ).withMotion(context, (a) => a.fadeIn(duration: 220.ms).slideX(begin: 0.08, end: 0, duration: 260.ms, curve: Curves.easeOutCubic)),
      ];
    } else {
      turn = [
        if (cue != null) ...[
          const SizedBox(height: 4),
          Text(l10n.missionWhatDoYouAnswer, style: displayStyle(size: 17, color: colors.textPrimary, bold: false)),
          const SizedBox(height: 6),
        ],
        // With a server that checks speech: answer out loud first, the options are the fallback.
        if (canAnswerOutLoud)
          Container(
            width: double.infinity,
            margin: const EdgeInsets.only(bottom: 8, top: 2),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: accent.primarySoft,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: accent.primary.withValues(alpha: 0.5)),
            ),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(LucideIcons.mic, size: 16, color: accent.primaryText),
                    const SizedBox(width: 6),
                    Flexible(
                      child: Text(
                        l10n.missionAnswerOutLoud,
                        style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: accent.primaryText),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  l10n.missionAnswerOutLoudHint,
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 13, height: 1.35, color: colors.textSecondary),
                ),
                const SizedBox(height: 10),
                RecordTake(
                  key: ValueKey('answer-$_exchange'),
                  voiceLocale: plan.voiceLocale,
                  centered: true,
                  check: SpeechTarget(expressionId: exchange.answer.id, chapterKey: plan.mission.chapterKey, missionKey: plan.mission.key),
                  onVerdict: (verdict) => _onSpokenAnswer(exchange, verdict),
                ),
              ],
            ),
          ),
        // The replies to choose from (tests reach them by this key: the thread above may hold the same words).
        Column(
          key: const ValueKey('replies'),
          children: [
            for (var i = 0; i < exchange.options.length; i++)
              OptionTile(
                semantics: exchange.options[i].romanization == null
                    ? exchange.options[i].text
                    : '${exchange.options[i].text}, ${exchange.options[i].romanization}',
                locale: contentLanguageOf(plan.track),
                state: _selected == i ? (i == exchange.answerIndex ? OptionState.right : OptionState.wrong) : OptionState.idle,
                onTap: () => _choose(exchange, i),
                child: TargetText(expression: exchange.options[i], track: plan.track, fontSize: 17),
              ),
          ],
        ),
        if (wrong)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(l10n.missionWrong, style: TextStyle(fontSize: 13.5, color: colors.error)).withMotion(context, (a) => a.fadeIn(duration: 200.ms)),
          ),
      ];
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(
          child: SingleChildScrollView(
            controller: _thread,
            padding: const EdgeInsets.only(top: 12, bottom: 12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [...thread, prompt, ...turn]),
          ),
        ),
        if (_answered)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (waitingForTake)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: SpeakingHint(tries: _sayStep.tries),
                  ),
                LearnPrimaryButton(
                  label: _answeredByVoice ? l10n.next : l10n.sceneISaidIt,
                  icon: _answeredByVoice ? LucideIcons.chevronRight : LucideIcons.check,
                  onPressed: waitingForTake ? null : () => _nextExchange(plan),
                ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _recapView(MissionLearnPlan plan) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final l10n = context.l10n;
    final answers = <String, MissionExchange>{for (final x in plan.exchanges) x.answer.id: x};
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 10),
        Row(
          children: [
            MeloWidget(state: MeloState.happy, courseTrackId: appState.activeTrackId, size: 48),
            const SizedBox(width: 10),
            Expanded(
              child: Semantics(
                header: true,
                child: Text(l10n.missionRecapTitle, style: displayStyle(size: 22, color: colors.textPrimary)),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Expanded(
          child: ListView(
            children: [
              for (final x in answers.values)
                Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: colors.surface,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: colors.border),
                  ),
                  child: Row(
                    children: [
                      // How the reply went: right the first time (and understood, where it was checked), or to review.
                      Icon(
                        (_firstTry[x.answer.id] ?? true) && (_spoken[x.answer.id] ?? true) ? LucideIcons.circleCheck : LucideIcons.rotateCcw,
                        size: 18,
                        color: (_firstTry[x.answer.id] ?? true) && (_spoken[x.answer.id] ?? true) ? colors.success : colors.amberText,
                      ),
                      const SizedBox(width: 10),
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
                      ListenButtons(text: x.answer.text, expressionId: x.answer.id, locale: plan.voiceLocale, compact: true, slow: false),
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
    final completed = Center(
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            MeloWidget(
              state: MeloState.celebrate,
              courseTrackId: appState.activeTrackId,
              size: 110,
            ).withMotion(context, (a) => a.scale(begin: const Offset(0.6, 0.6), duration: 650.ms, curve: Curves.elasticOut)),
            const SizedBox(height: 20),
            Text(
              l10n.missionCompleted,
              textAlign: TextAlign.center,
              style: displayStyle(size: 28, color: colors.textPrimary),
            ),
            const SizedBox(height: 8),
            if (_wasCompleted)
              Text(
                l10n.missionXpOnce,
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: accent.primaryText),
              )
            else
              CountUp(
                value: XpAmounts.missionCompleted,
                builder: (context, xp) => Text(
                  l10n.xpGain(xp),
                  textAlign: TextAlign.center,
                  style: displayStyle(size: 24, color: accent.primaryText),
                ),
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
            if (ref.watch(liveCallCourseProvider) != null && ref.watch(missionOnServerProvider(widget.missionKey)))
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
              )
            // Signed out on a course with live calls: the same practice, behind a free account.
            else if (ref.watch(callsNeedAccountProvider))
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: OutlinedButton.icon(
                  onPressed: () => context.push('/account'),
                  icon: const Icon(LucideIcons.phoneCall, size: 18),
                  label: Text(l10n.missionLiveCallAccount),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 48),
                    foregroundColor: accent.primaryText,
                    side: BorderSide(color: accent.primary),
                  ),
                ),
              ),
            // The same phrases, another way: the games (once there is enough to play with).
            if (ref.watch(gamesAvailableProvider))
              TextButton.icon(
                style: TextButton.styleFrom(minimumSize: const Size(48, 48), foregroundColor: accent.primaryText),
                onPressed: () => context.go('/play'),
                icon: const Icon(LucideIcons.gamepad2, size: 18),
                label: Text(l10n.pathPlayGames, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
              ),
            TextButton(
              style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
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
    return Stack(
      children: [
        completed,
        Positioned.fill(child: ConfettiBurst(colors: [accent.primary, colors.celebrationA, colors.celebrationB, colors.success, colors.amber])),
      ],
    );
  }
}
