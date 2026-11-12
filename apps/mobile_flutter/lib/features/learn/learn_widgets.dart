import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/content/content_models.dart';
import '../../core/backend/narrator.dart';
import '../../core/backend/server_voice.dart';
import '../../core/layout/motion.dart';
import '../../core/services/app_state.dart';
import '../../core/theme/script_fonts.dart';
import '../../l10n/l10n.dart';
import '../scenes/scene_models.dart';
import 'learn_logic.dart';

/// A BCP-47 tag (`es-ES`, `es-419`, `ar`, `zh-Hant-HK`) as a [Locale].
Locale localeFromTag(String tag) {
  final parts = tag.split(RegExp('[-_]'));
  String? script;
  String? region;
  for (final part in parts.skip(1)) {
    if (part.length == 4 && int.tryParse(part) == null) {
      script = '${part[0].toUpperCase()}${part.substring(1).toLowerCase()}';
    } else if (part.length == 2 || (part.length == 3 && int.tryParse(part) != null)) {
      region = part.toUpperCase();
    }
  }
  return Locale.fromSubtags(languageCode: parts.first.toLowerCase(), scriptCode: script, countryCode: region);
}

/// The locale of a course's phrases (`es-ES`, `ja-JP`, `ar-MA`): picks the font for characters that differ by language.
Locale contentLocaleOf(CourseTrackInfo track) => localeFromTag(track.defaultLocale);

/// The language of a course's phrases for assistive technology: screen readers switch to that language's voice
/// instead of reading a phrase with the interface language's rules. Language only (`ja`, not `ja-JP`): the web
/// engine writes the locale into the `lang` attribute with an underscore (`ja_JP`), which is not a language tag.
Locale contentLanguageOf(CourseTrackInfo track) => Locale(localeFromTag(track.defaultLocale).languageCode);

/// The painted scene for a blueprint situation (`cafe`, `market`, `directions`, …).
SceneId sceneIdForSituation(String situation) => switch (situation) {
  'cafe' => SceneId.cafe,
  'market' || 'shopping' => SceneId.market,
  'restaurant' => SceneId.restaurant,
  'directions' => SceneId.station,
  'transport' => SceneId.street,
  'travel' => SceneId.airport,
  'neighbours' || 'family' || 'daily_life' || 'housing' => SceneId.home,
  'work' => SceneId.office,
  'emergencies' || 'health' => SceneId.clinic,
  'plans' || 'debates' || 'story' => SceneId.gathering,
  _ => SceneId.street,
};

/// The painted scene of [mission]: where its conversation happens. A blueprint whose place its situation does not
/// say (a ticket office is "travel", like an airport; help is asked for in the street, not at the clinic) names it.
SceneId sceneIdForMission(Mission mission) => switch (mission.blueprintKey) {
  'buy_train_ticket' => SceneId.station,
  'emergency_ask_help' => SceneId.street,
  'describe_your_day' => SceneId.office,
  'talk_about_hobbies' || 'join_a_club' => SceneId.park,
  'ask_for_advice' => SceneId.cafe,
  'post_a_parcel' => SceneId.office,
  'return_an_item' => SceneId.market,
  'lost_luggage' => SceneId.airport,
  _ => sceneIdForSituation(mission.situation),
};

/// Localized name of a painted scene (the badge in its corner).
String sceneTitle(AppLocalizations l10n, SceneId id) => switch (id) {
  SceneId.cafe => l10n.sceneCafe,
  SceneId.street => l10n.sceneStreet,
  SceneId.airport => l10n.sceneAirport,
  SceneId.market => l10n.sceneMarket,
  SceneId.home => l10n.sceneHome,
  SceneId.office => l10n.sceneOffice,
  SceneId.transit => l10n.sceneTransit,
  SceneId.restaurant => l10n.sceneRestaurant,
  SceneId.gathering => l10n.sceneGathering,
  SceneId.station => l10n.sceneStation,
  SceneId.park => l10n.scenePark,
  SceneId.clinic => l10n.sceneClinic,
};

String stopLabel(AppLocalizations l10n, PathStop stop) => switch (stop) {
  PathStop.learn => l10n.stopLearn,
  PathStop.practise => l10n.stopPractise,
  PathStop.play => l10n.stopPlay,
  PathStop.mission => l10n.stopMission,
  PathStop.talk => l10n.stopTalk,
};

/// An expression in the target language: native script (right-to-left when the script is), then the reading aid
/// (Japanese kana) and the Latin romanization underneath when they differ from it.
class TargetText extends ConsumerWidget {
  final Expression expression;
  final CourseTrackInfo track;
  final double fontSize;
  final TextAlign textAlign;
  final Color? color;

  const TargetText({super.key, required this.expression, required this.track, this.fontSize = 22, this.textAlign = TextAlign.start, this.color});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    final align = textAlign == TextAlign.center ? CrossAxisAlignment.center : CrossAxisAlignment.start;
    final reading = expression.reading;
    final romanization = expression.romanization;
    return Column(
      crossAxisAlignment: align,
      mainAxisSize: MainAxisSize.min,
      children: [
        Semantics(
          localeForSubtree: contentLanguageOf(track),
          child: Text(
            expression.text,
            // Picks the font for characters that differ by language (Japanese kanji are not drawn with Chinese
            // forms on iOS and Android, whatever the interface language).
            locale: contentLocaleOf(track),
            textAlign: textAlign,
            textDirection: track.rtl ? TextDirection.rtl : TextDirection.ltr,
            style: TextStyle(
              fontSize: fontSize,
              fontWeight: FontWeight.w700,
              height: 1.3,
              color: color ?? colors.textPrimary,
              fontFamilyFallback: fontFallbackFor(track),
            ),
          ),
        ),
        if (reading != null) ...[
          const SizedBox(height: 2),
          Semantics(
            localeForSubtree: contentLanguageOf(track),
            child: Text(
              reading,
              locale: contentLocaleOf(track),
              textAlign: textAlign,
              style: TextStyle(fontSize: fontSize * 0.6, color: colors.textSecondary, fontFamilyFallback: fontFallbackFor(track)),
            ),
          ),
        ],
        if (romanization != null) ...[
          const SizedBox(height: 2),
          Text(
            romanization,
            textAlign: textAlign,
            style: TextStyle(fontSize: fontSize * 0.62, fontStyle: FontStyle.italic, color: colors.textMuted),
          ),
        ],
      ],
    );
  }
}

/// Top bar of every learn screen: close, title and progress — one segment per step of a short screen (the lines of
/// a scene, the cards), or one bar that fills up ([fraction], 0–1) for a long session.
class LearnTopBar extends ConsumerWidget {
  final String title;
  final int step;
  final int total;

  /// The share of the screen's work done: the bar is then continuous instead of one segment per step.
  final double? fraction;
  final VoidCallback onClose;

  const LearnTopBar({super.key, required this.title, required this.step, required this.total, required this.onClose, this.fraction});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final fraction = this.fraction;
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 4, 16, 4),
      child: Row(
        children: [
          IconButton(
            icon: Icon(LucideIcons.x, color: colors.textSecondary),
            tooltip: context.l10n.close,
            onPressed: onClose,
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: colors.textSecondary),
                ),
                const SizedBox(height: 6),
                Semantics(
                  label: context.l10n.stepOf(step, total),
                  child: fraction != null
                      ? ClipRRect(
                          borderRadius: BorderRadius.circular(4),
                          child: SizedBox(
                            height: 8,
                            child: Stack(
                              fit: StackFit.expand,
                              children: [
                                ColoredBox(color: colors.surfaceMuted),
                                TweenAnimationBuilder<double>(
                                  tween: Tween(end: fraction.clamp(0.0, 1.0)),
                                  duration: context.reduceMotion ? Duration.zero : const Duration(milliseconds: 350),
                                  curve: Curves.easeOutCubic,
                                  builder: (context, value, _) => FractionallySizedBox(
                                    alignment: AlignmentDirectional.centerStart,
                                    widthFactor: value,
                                    child: DecoratedBox(
                                      decoration: BoxDecoration(
                                        borderRadius: BorderRadius.circular(4),
                                        gradient: LinearGradient(colors: [accent.primary, accent.lantern[1]]),
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        )
                      : Row(
                          children: List.generate(total, (i) {
                            final done = i < step - 1;
                            final current = i == step - 1;
                            return Expanded(
                              child: AnimatedContainer(
                                duration: const Duration(milliseconds: 250),
                                height: 6,
                                margin: const EdgeInsets.symmetric(horizontal: 2),
                                decoration: BoxDecoration(
                                  color: done ? colors.success : (current ? accent.primary : colors.surfaceMuted),
                                  borderRadius: BorderRadius.circular(3),
                                ),
                              ),
                            );
                          }),
                        ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Replay + slow buttons for one target-language line. Rendered only when the device has a voice for exactly
/// [locale] (null: the variety may not be voiced by a device synthesizer) — no disabled placeholder otherwise.
class ListenButtons extends ConsumerWidget {
  final String text;
  final String? locale;

  /// The line's bundle id: where the device has no voice for the course, the server's AI voice says it.
  final String? expressionId;
  final bool compact;

  /// Also offer the line slowly (off where there is only room for one button).
  final bool slow;

  const ListenButtons({super.key, required this.text, required this.locale, this.expressionId, this.compact = false, this.slow = true});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final voice = ref.watch(lineVoiceProvider(locale)).asData?.value;
    if (voice == null || !voice.canSay(expressionId: expressionId)) return const SizedBox.shrink();
    final l10n = context.l10n;
    // The server's voice is said to be an AI voice (screen readers hear it; the course page says so too).
    final ai = voice.aiFor(expressionId);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        AudioChip(
          icon: ai ? LucideIcons.audioLines : LucideIcons.volume2,
          label: l10n.listen,
          semanticsLabel: ai ? l10n.listenAiVoiceSemantics : null,
          compact: compact,
          onTap: () => voice.say(text: text, expressionId: expressionId),
        ),
        if (slow) ...[
          const SizedBox(width: 8),
          AudioChip(
            icon: LucideIcons.turtle,
            label: l10n.listenSlowly,
            semanticsLabel: ai ? l10n.listenSlowlyAiVoiceSemantics : l10n.listenSlowlySemantics,
            compact: compact,
            onTap: () => voice.say(text: text, expressionId: expressionId, slow: true),
          ),
        ],
      ],
    );
  }
}

/// Reads the exercise's context and question aloud again (the narrator, in the learner's instruction language).
/// Rendered only where something can read it.
class ReadAloudButton extends ConsumerWidget {
  final VoidCallback onPressed;

  const ReadAloudButton({super.key, required this.onPressed});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (ref.watch(narrationAvailableProvider).asData?.value != true) return const SizedBox.shrink();
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    return IconButton(
      icon: Icon(LucideIcons.audioLines, size: 18, color: colors.textSecondary),
      tooltip: context.l10n.readAloud,
      visualDensity: VisualDensity.compact,
      onPressed: onPressed,
    );
  }
}

/// A rounded audio action — listen, record, play back — in the course accent, or in [background] / [foreground].
class AudioChip extends ConsumerWidget {
  final IconData icon;
  final String label;

  /// What a screen reader says, when it differs from [label] ("Slowly" → "Listen slowly").
  final String? semanticsLabel;

  /// Null disables the chip.
  final VoidCallback? onTap;
  final bool compact;
  final Color? background;
  final Color? foreground;

  const AudioChip({
    super.key,
    required this.icon,
    required this.label,
    this.semanticsLabel,
    this.onTap,
    this.compact = false,
    this.background,
    this.foreground,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final accent = ref.watch(appStateProvider.select((s) => s.accent));
    final ink = foreground ?? accent.primaryText;
    // Its own node: next to a phrase's meaning, the chip would otherwise merge with that text into one button.
    return Semantics(
      container: true,
      button: true,
      enabled: onTap != null,
      label: semanticsLabel ?? label,
      excludeSemantics: true,
      child: Opacity(
        opacity: onTap == null ? 0.55 : 1,
        child: InkWell(
          borderRadius: BorderRadius.circular(20),
          onTap: onTap,
          child: Container(
            constraints: const BoxConstraints(minHeight: 36),
            padding: EdgeInsets.symmetric(horizontal: compact ? 10 : 14, vertical: compact ? 6 : 9),
            decoration: BoxDecoration(color: background ?? accent.primarySoft, borderRadius: BorderRadius.circular(20)),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 16, color: ink),
                const SizedBox(width: 6),
                Text(
                  label,
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: ink),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The scene character: an initial in a ring that glows while they speak.
class CharacterBadge extends ConsumerWidget {
  final String name;
  final bool speaking;
  final double size;

  /// Show the name tag under the circle (off when the name is already written next to it).
  final bool showName;

  const CharacterBadge({super.key, required this.name, required this.speaking, this.size = 64, this.showName = true});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final accent = ref.watch(appStateProvider.select((s) => s.accent));
    final initial = name.isEmpty ? '?' : String.fromCharCode(name.runes.first).toUpperCase();
    return Semantics(
      label: speaking ? context.l10n.speakingSemantics(name) : name,
      excludeSemantics: true,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          AnimatedContainer(
            duration: const Duration(milliseconds: 300),
            width: size,
            height: size,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: const Color(0xFFF7EFE6),
              border: Border.all(color: speaking ? accent.primary : Colors.white, width: speaking ? 4 : 3),
              boxShadow: speaking ? [BoxShadow(color: accent.primary.withValues(alpha: 0.55), blurRadius: 18, spreadRadius: 2)] : null,
            ),
            alignment: Alignment.center,
            child: Text(
              initial,
              style: TextStyle(fontSize: size * 0.42, fontWeight: FontWeight.w800, color: const Color(0xFF3A2A22)),
            ),
          ).withMotion(
            context,
            // A gentle pulse while the character speaks.
            (a) => speaking ? a.animate(onPlay: (c) => c.repeat(reverse: true)).scaleXY(begin: 1, end: 1.05, duration: 520.ms, curve: Curves.easeInOut) : a,
          ),
          if (showName) ...[
            const SizedBox(height: 4),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(color: const Color(0xB30B0913), borderRadius: BorderRadius.circular(8)),
              child: Text(
                name,
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Colors.white),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// A line of the conversation as a chat bubble: the character's on the left, behind their initial; the learner's on
/// the right, in the course's colour. [faded]: a line already exchanged, kept above as the thread of the conversation.
class LineBubble extends ConsumerWidget {
  const LineBubble({
    super.key,
    required this.expression,
    required this.track,
    required this.meaning,
    required this.byLearner,
    this.speakerName = '',
    this.faded = false,
    this.speaking = false,
    this.fontSize = 18,
    this.footer,
  });

  final Expression expression;
  final CourseTrackInfo track;
  final String meaning;
  final bool byLearner;

  /// The character's name, written above their line.
  final String speakerName;
  final bool faded;

  /// The character is saying this line now (their initial glows).
  final bool speaking;
  final double fontSize;

  /// Under the line: listening to it, recording it.
  final Widget? footer;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    const corner = Radius.circular(20);
    const tail = Radius.circular(6);
    final bubble = Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
      decoration: BoxDecoration(
        color: byLearner ? accent.primarySoft : colors.surface,
        borderRadius: BorderRadiusDirectional.only(
          topStart: corner,
          topEnd: corner,
          bottomStart: byLearner ? corner : tail,
          bottomEnd: byLearner ? tail : corner,
        ),
        border: Border.all(color: byLearner ? accent.primary.withValues(alpha: 0.55) : colors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (!byLearner && speakerName.isNotEmpty) ...[
            Text(
              speakerName,
              style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: accent.primaryText),
            ),
            const SizedBox(height: 3),
          ],
          TargetText(expression: expression, track: track, fontSize: fontSize),
          const SizedBox(height: 3),
          Text(meaning, style: TextStyle(fontSize: 13.5, height: 1.3, color: colors.textSecondary)),
          if (footer != null) ...[const SizedBox(height: 8), footer!],
        ],
      ),
    );
    return Opacity(
      opacity: faded ? 0.62 : 1,
      child: Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Row(
          mainAxisAlignment: byLearner ? MainAxisAlignment.end : MainAxisAlignment.start,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            if (byLearner)
              const SizedBox(width: 44)
            else ...[
              CharacterBadge(name: speakerName, speaking: speaking, size: 34, showName: false),
              const SizedBox(width: 8),
            ],
            Flexible(child: bubble),
            if (!byLearner) const SizedBox(width: 24),
          ],
        ),
      ),
    );
  }
}

/// The one primary action at the bottom of a learn screen.
class LearnPrimaryButton extends ConsumerWidget {
  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;

  const LearnPrimaryButton({super.key, required this.label, required this.onPressed, this.icon});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final accent = ref.watch(appStateProvider.select((s) => s.accent));
    return SizedBox(
      width: double.infinity,
      height: 52,
      child: FilledButton(
        style: FilledButton.styleFrom(
          backgroundColor: accent.primary,
          foregroundColor: accent.onPrimary,
          disabledForegroundColor: accent.onPrimary.withValues(alpha: 0.6),
          disabledBackgroundColor: accent.primary.withValues(alpha: 0.35),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
        ),
        onPressed: onPressed,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis)),
            if (icon != null) ...[const SizedBox(width: 8), Icon(icon, size: 18)],
          ],
        ),
      ),
    );
  }
}

/// Shown instead of a learn screen when its mission is not in the active course (stale link, course switched).
class MissionUnavailable extends ConsumerWidget {
  const MissionUnavailable({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(LucideIcons.mapPinOff, size: 40, color: colors.textMuted),
                const SizedBox(height: 12),
                Text(
                  context.l10n.missionNotFound,
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 16, color: colors.textPrimary),
                ),
                const SizedBox(height: 20),
                LearnPrimaryButton(label: context.l10n.backHome, onPressed: () => context.go('/')),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
