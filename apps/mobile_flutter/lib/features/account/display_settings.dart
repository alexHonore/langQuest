import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/services/app_state.dart';
import '../../core/services/learner_state.dart';
import '../../core/theme/glass.dart';
import '../../l10n/l10n.dart';

enum _Theme { dark, light, device }

/// Settings › Display: the theme (dark, light, or the device's), the text size, reduced motion and the mascot — the
/// Expo app's accessibility choices that apply to this app. Saved on this device with the rest of the learner's state.
class DisplaySettings extends ConsumerWidget {
  const DisplaySettings({super.key});

  static String _percent(double scale) => '${(scale * 100).round()}%';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final notifier = ref.read(appStateProvider.notifier);
    final learner = appState.learner;
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final title = TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: colors.textPrimary);
    final note = TextStyle(fontSize: 12.5, height: 1.35, color: colors.textMuted);
    // The device's own setting, before the learner's choice is added on top.
    final deviceStill = View.of(context).platformDispatcher.accessibilityFeatures.disableAnimations;
    final theme = learner.followDeviceTheme ? _Theme.device : (learner.darkMode ? _Theme.dark : _Theme.light);
    final sizeIndex = textScales.indexOf(nearestTextScale(learner.textScale));
    // Steps, not a slider: a slider keeps an overlay for its value bubble (an empty full-screen node in the web
    // accessibility tree), and the screen would reflow under a dragging finger.
    Widget step(IconData icon, String tooltip, int to) => IconButton.filledTonal(
      icon: Icon(icon, size: 18),
      tooltip: tooltip,
      onPressed: to < 0 || to >= textScales.length ? null : () => notifier.setTextScale(textScales[to]),
    );

    Widget card(Widget child) => Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: GlassContainer(
        level: GlassLevel.level1,
        radius: 18,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        // ListTile ink needs a Material between it and the glass decoration.
        child: Material(type: MaterialType.transparency, child: child),
      ),
    );

    Widget toggle({required IconData icon, required String label, required String body, required bool value, ValueChanged<bool>? onChanged}) => card(
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        secondary: Icon(icon, size: 20, color: colors.textSecondary),
        title: Text(label, style: title),
        subtitle: Text(body, style: note),
        value: value,
        activeThumbColor: accent.primary,
        onChanged: onChanged,
      ),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: SegmentedButton<_Theme>(
            segments: [
              ButtonSegment(value: _Theme.dark, icon: const Icon(LucideIcons.moon, size: 16), label: Text(l10n.themeDark)),
              ButtonSegment(value: _Theme.light, icon: const Icon(LucideIcons.sun, size: 16), label: Text(l10n.themeLight)),
              ButtonSegment(value: _Theme.device, icon: const Icon(LucideIcons.smartphone, size: 16), label: Text(l10n.themeDevice)),
            ],
            selected: {theme},
            showSelectedIcon: false,
            onSelectionChanged: (s) => switch (s.first) {
              _Theme.dark => notifier.setDarkMode(true),
              _Theme.light => notifier.setDarkMode(false),
              _Theme.device => notifier.followDeviceTheme(MediaQuery.platformBrightnessOf(context) == Brightness.dark),
            },
          ),
        ),
        card(
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(LucideIcons.aLargeSmall, size: 20, color: colors.textSecondary),
                    const SizedBox(width: 16),
                    Expanded(child: Text(l10n.textSize, style: title)),
                    step(LucideIcons.minus, l10n.textSmaller, sizeIndex - 1),
                    Semantics(
                      liveRegion: true,
                      label: l10n.textSizeValue(_percent(textScales[sizeIndex])),
                      excludeSemantics: true,
                      child: SizedBox(
                        width: 64,
                        child: Text(
                          _percent(textScales[sizeIndex]),
                          textAlign: TextAlign.center,
                          style: title.copyWith(color: accent.primaryText),
                        ),
                      ),
                    ),
                    step(LucideIcons.plus, l10n.textLarger, sizeIndex + 1),
                  ],
                ),
                const SizedBox(height: 6),
                Text(l10n.textSizeBody, style: note),
              ],
            ),
          ),
        ),
        toggle(
          icon: LucideIcons.pause,
          label: l10n.reduceMotion,
          body: deviceStill ? l10n.reduceMotionDevice : l10n.reduceMotionBody,
          value: deviceStill || learner.reduceMotion,
          onChanged: deviceStill ? null : notifier.setReduceMotion,
        ),
        toggle(icon: LucideIcons.smile, label: l10n.showMascot, body: l10n.showMascotBody, value: learner.mascot, onChanged: notifier.setMascot),
      ],
    );
  }
}
