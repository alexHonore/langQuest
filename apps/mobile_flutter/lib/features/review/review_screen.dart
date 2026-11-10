import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../navigation/nav.dart';
import '../../core/content/content_bundle.dart';
import '../../core/content/content_models.dart';
import '../../core/learning/srs.dart';
import '../../core/services/app_state.dart';
import '../../l10n/l10n.dart';
import '../learn/learn_content.dart';
import '../learn/learn_widgets.dart';
import '../mascot/melo_model.dart';
import '../mascot/melo_widget.dart';

/// Spaced review (§3.5): the phrases the learner used in missions come back when the scheduler says they are about
/// to be forgotten. Production recall: the meaning is shown, the learner says the phrase out loud, then reveals it
/// and rates how it went (Again / Hard / Good / Easy). The queue is fixed when the screen opens; a card rated
/// "again" comes back in a later sitting.
class ReviewScreen extends ConsumerStatefulWidget {
  const ReviewScreen({super.key});

  @override
  ConsumerState<ReviewScreen> createState() => _ReviewScreenState();
}

class _ReviewScreenState extends ConsumerState<ReviewScreen> {
  late final List<String> _queue;
  int _position = 0;
  bool _revealed = false;

  @override
  void initState() {
    super.initState();
    final now = ref.read(clockProvider)();
    final appState = ref.read(appStateProvider);
    final course = appState.activeCourse;
    final content = ref.read(contentBundleProvider);
    // A card whose phrase is no longer in the course content (content update) is skipped, not shown blank.
    _queue = [
      if (course != null)
        for (final c in appState.dueCards(now))
          if (_lookup(content, course, c.id) != null) c.id,
    ];
  }

  void _rate(ReviewRating rating) {
    ref.read(appStateProvider.notifier).reviewCard(_queue[_position], rating);
    setState(() {
      _position++;
      _revealed = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final course = appState.activeCourse;
    final content = ref.watch(contentBundleProvider);
    final remaining = _queue.length - _position;
    final current = remaining > 0 && course != null ? _lookup(content, course, _queue[_position]) : null;

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
                    child: Text(
                      l10n.reviewTitle,
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: colors.textPrimary),
                    ),
                  ),
                  if (remaining > 0)
                    Text(
                      l10n.reviewLeft(remaining),
                      style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: colors.textMuted),
                    ),
                ],
              ),
            ),
            Expanded(
              child: current == null || course == null
                  ? _doneView()
                  : Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const SizedBox(height: 12),
                          Expanded(
                            child: AnimatedSwitcher(
                              duration: const Duration(milliseconds: 220),
                              child: Container(
                                key: ValueKey('${_queue[_position]}-$_revealed'),
                                padding: const EdgeInsets.all(22),
                                decoration: BoxDecoration(
                                  color: colors.surface,
                                  borderRadius: BorderRadius.circular(26),
                                  border: Border.all(color: _revealed ? accent.primary.withValues(alpha: 0.6) : colors.border, width: _revealed ? 1.5 : 1),
                                  boxShadow: [BoxShadow(color: accent.primary.withValues(alpha: 0.12), blurRadius: 24, offset: const Offset(0, 8))],
                                ),
                                child: Center(
                                  child: SingleChildScrollView(
                                    child: Column(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Text(
                                          l10n.reviewHowDoYouSay,
                                          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, letterSpacing: 0.5, color: colors.textMuted),
                                        ),
                                        const SizedBox(height: 10),
                                        Text(
                                          current.plan.promptMeaningOf(current.expression),
                                          textAlign: TextAlign.center,
                                          style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: colors.textPrimary),
                                        ),
                                        const SizedBox(height: 20),
                                        if (!_revealed)
                                          Text(
                                            l10n.reviewSayThenShow,
                                            textAlign: TextAlign.center,
                                            style: TextStyle(fontSize: 14, color: colors.textSecondary),
                                          )
                                        else ...[
                                          Divider(color: colors.border),
                                          const SizedBox(height: 14),
                                          TargetText(expression: current.expression, track: course.track, fontSize: 28, textAlign: TextAlign.center),
                                          const SizedBox(height: 14),
                                          ListenButtons(text: current.expression.text, locale: course.track.voiceLocale),
                                          if (current.plan.noteOf(current.expression) case final note?) ...[
                                            const SizedBox(height: 14),
                                            Text(
                                              note,
                                              textAlign: TextAlign.center,
                                              style: TextStyle(fontSize: 13, height: 1.35, color: colors.textSecondary),
                                            ),
                                          ],
                                        ],
                                      ],
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(height: 16),
                          if (!_revealed)
                            LearnPrimaryButton(label: l10n.reviewShowAnswer, icon: LucideIcons.eye, onPressed: () => setState(() => _revealed = true))
                          else
                            Row(
                              children: [
                                for (final (rating, label, color) in [
                                  (ReviewRating.again, l10n.reviewAgain, colors.error),
                                  (ReviewRating.hard, l10n.reviewHard, colors.warning),
                                  (ReviewRating.good, l10n.reviewGood, colors.success),
                                  (ReviewRating.easy, l10n.reviewEasy, colors.info),
                                ])
                                  Expanded(
                                    child: Padding(
                                      padding: const EdgeInsets.symmetric(horizontal: 4),
                                      child: OutlinedButton(
                                        style: OutlinedButton.styleFrom(
                                          minimumSize: const Size(0, 52),
                                          padding: const EdgeInsets.symmetric(horizontal: 4),
                                          foregroundColor: color,
                                          side: BorderSide(color: color, width: 1.5),
                                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                                        ),
                                        onPressed: () => _rate(rating),
                                        child: FittedBox(
                                          fit: BoxFit.scaleDown,
                                          child: Text(label, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
                                        ),
                                      ),
                                    ),
                                  ),
                              ],
                            ).animate().fadeIn(duration: 200.ms),
                          const SizedBox(height: 16),
                        ],
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _doneView() {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final l10n = context.l10n;
    final hasCards = appState.progress.cards.isNotEmpty;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            MeloWidget(state: hasCards ? MeloState.celebrate : MeloState.curious, courseTrackId: appState.activeTrackId, size: 100),
            const SizedBox(height: 20),
            Text(
              hasCards ? l10n.reviewAllDone : l10n.reviewEmpty,
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: colors.textPrimary),
            ),
            const SizedBox(height: 28),
            LearnPrimaryButton(label: l10n.backHome, icon: LucideIcons.house, onPressed: () => context.go('/')),
          ],
        ),
      ),
    );
  }
}

class _ReviewItem {
  final Expression expression;
  final MissionLearnPlan plan;
  const _ReviewItem(this.expression, this.plan);
}

/// Find a card's expression (ids are `<chapter>:<mission>:<expression>`) with the plan that gives its meaning.
_ReviewItem? _lookup(ContentBundle content, Course course, String expressionId) {
  final parts = expressionId.split(':');
  if (parts.length != 3) return null;
  final mission = content.mission(parts[1]);
  if (mission == null || course.indexOfMission(mission.key) < 0) return null;
  for (final e in mission.expressions) {
    if (e.id == expressionId) {
      return _ReviewItem(e, buildLearnPlan(mission: mission, track: course.track, source: course.source, character: content.characterOf(mission)));
    }
  }
  return null;
}
