import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/backend/server_voice.dart';
import '../../core/content/content_models.dart';
import '../../core/layout/motion.dart';
import '../../core/services/app_state.dart';
import '../../core/theme/typography.dart';
import '../../l10n/l10n.dart';
import '../mascot/melo_model.dart';
import '../mascot/melo_widget.dart';
import 'learn_widgets.dart';

/// What every exercise and mini-game is drawn with: the question, an answer to choose, the big listen button, a word
/// tile, and the panel that says how an answer went.

/// The heading of an exercise: Melo and the question, under an optional tag that says where the question comes from
/// ("From an earlier mission", "Once more").
class ExercisePrompt extends ConsumerWidget {
  const ExercisePrompt({super.key, required this.text, this.mood = MeloState.curious, this.tag, this.tagIcon});

  final String text;
  final MeloState mood;
  final String? tag;
  final IconData? tagIcon;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (tag != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(color: colors.amber.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(12)),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(tagIcon ?? LucideIcons.history, size: 13, color: colors.amberText),
                  const SizedBox(width: 6),
                  Flexible(
                    child: Text(
                      tag!,
                      style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: colors.amberText),
                    ),
                  ),
                ],
              ),
            ),
          ),
        Row(
          children: [
            MeloWidget(state: mood, courseTrackId: appState.activeTrackId, size: 52),
            const SizedBox(width: 10),
            Expanded(
              child: Semantics(
                header: true,
                child: Text(text, style: displayStyle(size: 20, color: colors.textPrimary, height: 1.2, bold: false)),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// How an answer looks: not chosen yet, the right one, the wrong one that was picked, or one of the others once
/// the question is answered.
enum OptionState { idle, right, wrong, dimmed }

/// One answer to choose. A wrong pick shakes and the right one pops (not under reduced motion).
class OptionTile extends ConsumerWidget {
  const OptionTile({super.key, required this.semantics, required this.child, required this.state, required this.onTap, this.locale, this.marker = true});

  /// What a screen reader says for this answer (the option itself: its state is added).
  final String semantics;
  final Widget child;
  final OptionState state;

  /// Null once the question is answered.
  final VoidCallback? onTap;

  /// The language of [semantics], when it is a phrase of the course.
  final Locale? locale;

  /// The round marker in front of the answer (off for a single word or a short button).
  final bool marker;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    final l10n = context.l10n;
    final (fill, border) = switch (state) {
      OptionState.right => (colors.successSoft, colors.success),
      OptionState.wrong => (colors.errorSoft, colors.error),
      OptionState.idle || OptionState.dimmed => (colors.surface, colors.border),
    };
    final decided = state == OptionState.right || state == OptionState.wrong;
    final box = AnimatedContainer(
      duration: const Duration(milliseconds: 180),
      width: double.infinity,
      constraints: const BoxConstraints(minHeight: 58),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: fill,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: border, width: decided ? 2 : 1),
      ),
      child: Row(
        children: [
          if (marker) ...[
            AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              width: 24,
              height: 24,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: decided ? border : Colors.transparent,
                border: Border.all(color: decided ? border : colors.borderStrong, width: 1.5),
              ),
              child: decided ? Icon(state == OptionState.right ? LucideIcons.check : LucideIcons.x, size: 15, color: colors.background) : null,
            ),
            const SizedBox(width: 12),
          ],
          Expanded(child: child),
        ],
      ),
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Semantics(
        button: true,
        enabled: onTap != null,
        label: switch (state) {
          OptionState.wrong => l10n.practiceWrongSemantics(semantics),
          OptionState.right => l10n.practiceRightSemantics(semantics),
          OptionState.idle || OptionState.dimmed => semantics,
        },
        localeForSubtree: locale,
        excludeSemantics: true,
        child: Opacity(
          opacity: state == OptionState.dimmed ? 0.5 : 1,
          child: InkWell(
            borderRadius: BorderRadius.circular(18),
            onTap: onTap,
            // The new key replays the effect each time the state changes.
            child: KeyedSubtree(
              key: ValueKey(state),
              child: box.withMotion(
                context,
                (a) => switch (state) {
                  OptionState.wrong => a.shake(hz: 5, offset: const Offset(6, 0), rotation: 0, duration: 420.ms),
                  OptionState.right =>
                    a.scaleXY(begin: 1, end: 1.03, duration: 130.ms, curve: Curves.easeOut).then().scaleXY(begin: 1.03, end: 1, duration: 180.ms),
                  OptionState.idle || OptionState.dimmed => a,
                },
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The state of option [index] once [picked] is known (null: not answered yet) and [answer] is the right one.
OptionState optionState(int index, {required int? picked, required int answer}) {
  if (picked == null) return OptionState.idle;
  if (index == answer) return OptionState.right;
  return index == picked ? OptionState.wrong : OptionState.dimmed;
}

/// The listening exercises' big round button, with "Slowly" beside it. Rendered only where the phrase can be said.
class BigListen extends ConsumerWidget {
  const BigListen({super.key, required this.expression, required this.locale});

  final Expression expression;
  final String? locale;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final voice = ref.watch(lineVoiceNowProvider(locale));
    if (voice == null || !voice.canSay(expressionId: expression.id)) return const SizedBox.shrink();
    final accent = ref.watch(appStateProvider.select((s) => s.accent));
    final l10n = context.l10n;
    final ai = voice.aiFor(expression.id);
    void say({bool slow = false}) => voice.say(text: expression.text, expressionId: expression.id, slow: slow);
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Semantics(
          container: true,
          button: true,
          label: ai ? l10n.listenAiVoiceSemantics : l10n.listen,
          excludeSemantics: true,
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: say,
            child: Container(
              width: 76,
              height: 76,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: accent.primary,
                boxShadow: [BoxShadow(color: accent.primary.withValues(alpha: 0.45), blurRadius: 22, spreadRadius: 1)],
              ),
              child: Icon(LucideIcons.volume2, size: 32, color: accent.onPrimary),
            ),
          ),
        ),
        const SizedBox(width: 14),
        Semantics(
          container: true,
          button: true,
          label: ai ? l10n.listenSlowlyAiVoiceSemantics : l10n.listenSlowlySemantics,
          excludeSemantics: true,
          child: InkWell(
            borderRadius: BorderRadius.circular(24),
            onTap: () => say(slow: true),
            child: Container(
              constraints: const BoxConstraints(minHeight: 48, minWidth: 48),
              padding: const EdgeInsets.symmetric(horizontal: 14),
              decoration: BoxDecoration(color: accent.primarySoft, borderRadius: BorderRadius.circular(24)),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(LucideIcons.turtle, size: 18, color: accent.primaryText),
                  const SizedBox(width: 6),
                  Text(
                    l10n.listenSlowly,
                    style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: accent.primaryText),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// A word to place or take back. [verdict]: after a check, whether the word is where it belongs.
class WordTile extends ConsumerWidget {
  const WordTile({super.key, required this.word, required this.semantics, required this.onTap, this.placed = false, this.verdict});

  final String word;
  final String semantics;
  final VoidCallback? onTap;

  /// In the sentence being built (else in the bank of words to choose from).
  final bool placed;
  final bool? verdict;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final (fill, border) = switch (verdict) {
      true => (colors.successSoft, colors.success),
      false => (colors.errorSoft, colors.error),
      null => placed ? (accent.primarySoft, accent.primary) : (colors.elevated, colors.borderStrong.withValues(alpha: 0.45)),
    };
    return Semantics(
      button: true,
      label: semantics,
      excludeSemantics: true,
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          constraints: const BoxConstraints(minHeight: 48, minWidth: 48),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: fill,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: border, width: verdict == null ? 1 : 1.5),
            // A tile in the bank sits a little above the page, like a token to pick up.
            boxShadow: placed || verdict != null ? null : [BoxShadow(color: colors.background.withValues(alpha: 0.6), offset: const Offset(0, 2))],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Flexible(
                child: Text(
                  word,
                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: colors.textPrimary),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// What an answer came to, with the phrase it was about and the way on. It takes the place of the action button.
class FeedbackPanel extends ConsumerWidget {
  const FeedbackPanel({
    super.key,
    required this.correct,
    required this.title,
    required this.expression,
    required this.track,
    required this.meaning,
    required this.voiceLocale,
    required this.continueLabel,
    required this.onContinue,
    this.note,
  });

  final bool correct;
  final String title;

  /// The phrase the question was about, shown with its meaning.
  final Expression expression;
  final CourseTrackInfo track;
  final String meaning;
  final String? voiceLocale;

  /// One more line: the accents to mind, or that the question comes back.
  final String? note;
  final String continueLabel;
  final VoidCallback onContinue;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    final ink = correct ? colors.success : colors.error;
    final panel = Container(
      width: double.infinity,
      constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.62),
      decoration: BoxDecoration(
        color: correct ? colors.successSoft : colors.errorSoft,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(26)),
        border: Border(top: BorderSide(color: ink.withValues(alpha: 0.7), width: 1.5)),
      ),
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Flexible(
            child: SingleChildScrollView(
              child: Semantics(
                liveRegion: true,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      children: [
                        Icon(correct ? LucideIcons.circleCheck : LucideIcons.circleX, size: 22, color: ink),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(title, style: displayStyle(size: 19, color: ink)),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              TargetText(expression: expression, track: track, fontSize: 18),
                              const SizedBox(height: 2),
                              Text(meaning, style: TextStyle(fontSize: 14, height: 1.3, color: colors.textSecondary)),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        ListenButtons(text: expression.text, expressionId: expression.id, locale: voiceLocale, compact: true, slow: false),
                      ],
                    ),
                    if (note != null) ...[
                      const SizedBox(height: 6),
                      Text(
                        note!,
                        style: TextStyle(fontSize: 13.5, height: 1.3, fontWeight: FontWeight.w600, color: ink),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            height: 52,
            child: FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: ink,
                foregroundColor: colors.background,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
                textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
              ),
              onPressed: onContinue,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Flexible(child: Text(continueLabel, maxLines: 1, overflow: TextOverflow.ellipsis)),
                  const SizedBox(width: 8),
                  const Icon(LucideIcons.chevronRight, size: 18),
                ],
              ),
            ),
          ),
        ],
      ),
    );
    return panel.withMotion(context, (a) => a.slideY(begin: 0.25, end: 0, duration: 220.ms, curve: Curves.easeOutCubic).fadeIn(duration: 160.ms));
  }
}
