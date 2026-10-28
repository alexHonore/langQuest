import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/services/app_state.dart';
import '../../core/services/speech_service.dart';
import '../scenes/scene_models.dart';

/// Map a mission's scene name ('cafe', 'street', …) to the painted scene.
SceneId sceneIdFromName(String name) => SceneId.values.firstWhere(
  (s) => s.name == name,
  orElse: () => SceneId.cafe,
);

/// Top bar of every learn screen: close, title, and one dot per step of the current screen.
class LearnTopBar extends ConsumerWidget {
  final String title;
  final int step;
  final int total;
  final VoidCallback onClose;

  const LearnTopBar({
    super.key,
    required this.title,
    required this.step,
    required this.total,
    required this.onClose,
  });

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
            tooltip: 'Close',
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
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: colors.textPrimary,
                  ),
                ),
                const SizedBox(height: 6),
                Semantics(
                  label: 'Step $step of $total',
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
                            color: done
                                ? colors.success
                                : (current ? accent.primary : colors.border),
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

/// Replay + slow buttons for one target-language line. Rendered only when the device has a voice for
/// [locale] (no disabled placeholder when it does not).
class ListenButtons extends ConsumerWidget {
  final String text;
  final String locale;
  final bool compact;

  const ListenButtons({
    super.key,
    required this.text,
    required this.locale,
    this.compact = false,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final available =
        ref.watch(voiceAvailableProvider(locale)).asData?.value ?? false;
    if (!available) return const SizedBox.shrink();
    final appState = ref.watch(appStateProvider);
    final accent = appState.accent;
    final speech = ref.read(speechServiceProvider);
    Widget chip(IconData icon, String label, bool slow) => Semantics(
      button: true,
      label: slow ? 'Listen slowly' : 'Listen',
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: () => speech.speak(text, locale: locale, slow: slow),
        child: Container(
          padding: EdgeInsets.symmetric(
            horizontal: compact ? 10 : 14,
            vertical: compact ? 6 : 9,
          ),
          decoration: BoxDecoration(
            color: accent.primarySoft,
            borderRadius: BorderRadius.circular(20),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 16, color: accent.primaryText),
              const SizedBox(width: 6),
              Text(
                label,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: accent.primaryText,
                ),
              ),
            ],
          ),
        ),
      ),
    );
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        chip(LucideIcons.volume2, 'Listen', false),
        const SizedBox(width: 8),
        chip(LucideIcons.turtle, 'Slowly', true),
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

  const CharacterBadge({
    super.key,
    required this.name,
    required this.speaking,
    this.size = 64,
    this.showName = true,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final accent = ref.watch(appStateProvider).accent;
    return Semantics(
      label: speaking ? '$name is speaking' : name,
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
              border: Border.all(
                color: speaking ? accent.primary : Colors.white,
                width: speaking ? 4 : 3,
              ),
              boxShadow: speaking
                  ? [
                      BoxShadow(
                        color: accent.primary.withValues(alpha: 0.55),
                        blurRadius: 18,
                        spreadRadius: 2,
                      ),
                    ]
                  : null,
            ),
            alignment: Alignment.center,
            child: Text(
              name.isEmpty ? '?' : name.substring(0, 1).toUpperCase(),
              style: TextStyle(
                fontSize: size * 0.42,
                fontWeight: FontWeight.w800,
                color: const Color(0xFF3A2A22),
              ),
            ),
          ),
          if (showName) const SizedBox(height: 4),
          if (showName)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: const Color(0xB30B0913),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                name,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: Colors.white,
                ),
              ),
            ),
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

  const LearnPrimaryButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final accent = ref.watch(appStateProvider).accent;
    return SizedBox(
      width: double.infinity,
      height: 52,
      child: FilledButton(
        style: FilledButton.styleFrom(
          backgroundColor: accent.primary,
          // White on the course accent, as on Home's primary button (onPrimary is near-black in dark mode).
          foregroundColor: Colors.white,
          disabledForegroundColor: Colors.white.withValues(alpha: 0.6),
          disabledBackgroundColor: accent.primary.withValues(alpha: 0.35),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(26),
          ),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
        ),
        onPressed: onPressed,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(label),
            if (icon != null) ...[
              const SizedBox(width: 8),
              Icon(icon, size: 18),
            ],
          ],
        ),
      ),
    );
  }
}
