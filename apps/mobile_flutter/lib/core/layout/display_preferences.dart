import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/app_state.dart';
import '../services/learner_state.dart';

/// Applies Settings › Display to everything below it: the text size (on top of the device's own), reduced motion (on
/// top of the device's own setting), and — while the learner follows the device's theme — the device switching
/// between light and dark.
class DisplayPreferences extends ConsumerStatefulWidget {
  const DisplayPreferences({super.key, required this.learner, required this.child});

  final LearnerState learner;
  final Widget child;

  /// The device's text size with the learner's [factor] on top.
  static TextScaler scaled(TextScaler device, double factor) => factor == 1 ? device : TextScaler.linear(device.scale(16) / 16 * factor);

  @override
  ConsumerState<DisplayPreferences> createState() => _DisplayPreferencesState();
}

class _DisplayPreferencesState extends ConsumerState<DisplayPreferences> {
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _followDevice();
  }

  @override
  void didUpdateWidget(DisplayPreferences old) {
    super.didUpdateWidget(old);
    _followDevice();
  }

  /// Mirrors the device's light/dark setting while the learner follows it.
  void _followDevice() {
    final learner = widget.learner;
    if (!learner.followDeviceTheme) return;
    final dark = MediaQuery.platformBrightnessOf(context) == Brightness.dark;
    if (dark == learner.darkMode) return;
    // After this frame: changing the learner's state rebuilds the app.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) ref.read(appStateProvider.notifier).deviceThemeChanged(dark);
    });
  }

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final learner = widget.learner;
    // Always a MediaQuery here, so turning a preference on or off never rebuilds the app below from scratch.
    return MediaQuery(
      data: media.copyWith(
        textScaler: DisplayPreferences.scaled(media.textScaler, learner.textScale),
        disableAnimations: media.disableAnimations || learner.reduceMotion,
      ),
      child: widget.child,
    );
  }
}
