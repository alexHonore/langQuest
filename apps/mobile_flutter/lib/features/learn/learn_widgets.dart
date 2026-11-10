import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/content/content_models.dart';
import '../../core/services/app_state.dart';
import '../../core/services/speech_service.dart';
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
  'neighbours' || 'family' || 'daily_life' => SceneId.home,
  'work' => SceneId.office,
  'emergencies' => SceneId.clinic,
  'plans' || 'debates' || 'story' => SceneId.gathering,
  _ => SceneId.street,
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
            style: TextStyle(fontSize: fontSize, fontWeight: FontWeight.w700, height: 1.3, color: color ?? colors.textPrimary),
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
              style: TextStyle(fontSize: fontSize * 0.6, color: colors.textSecondary),
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

/// Top bar of every learn screen: close, title, and one dot per step of the current screen.
class LearnTopBar extends ConsumerWidget {
  final String title;
  final int step;
  final int total;
  final VoidCallback onClose;

  const LearnTopBar({super.key, required this.title, required this.step, required this.total, required this.onClose});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
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
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: colors.textPrimary),
                ),
                const SizedBox(height: 6),
                Semantics(
                  label: context.l10n.stepOf(step, total),
                  child: Row(
                    children: List.generate(total, (i) {
                      final done = i < step - 1;
                      final current = i == step - 1;
                      return Expanded(
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 250),
                          height: 4,
                          margin: const EdgeInsets.symmetric(horizontal: 2),
                          decoration: BoxDecoration(
                            color: done ? colors.success : (current ? accent.primary : colors.border),
                            borderRadius: BorderRadius.circular(2),
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
  final bool compact;

  const ListenButtons({super.key, required this.text, required this.locale, this.compact = false});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final voiceLocale = locale;
    final available = ref.watch(voiceAvailableProvider(voiceLocale)).asData?.value ?? false;
    if (!available || voiceLocale == null) return const SizedBox.shrink();
    final accent = ref.watch(appStateProvider.select((s) => s.accent));
    final speech = ref.read(speechServiceProvider);
    final l10n = context.l10n;
    Widget chip(IconData icon, String label, String semantics, bool slow) => Semantics(
      button: true,
      label: semantics,
      excludeSemantics: true,
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: () => speech.speak(text, locale: voiceLocale, slow: slow),
        child: Container(
          constraints: const BoxConstraints(minHeight: 36),
          padding: EdgeInsets.symmetric(horizontal: compact ? 10 : 14, vertical: compact ? 6 : 9),
          decoration: BoxDecoration(color: accent.primarySoft, borderRadius: BorderRadius.circular(20)),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 16, color: accent.primaryText),
              const SizedBox(width: 6),
              Text(
                label,
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: accent.primaryText),
              ),
            ],
          ),
        ),
      ),
    );
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        chip(LucideIcons.volume2, l10n.listen, l10n.listen, false),
        const SizedBox(width: 8),
        chip(LucideIcons.turtle, l10n.listenSlowly, l10n.listenSlowlySemantics, true),
      ],
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
