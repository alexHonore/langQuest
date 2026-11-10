import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

/// Reduced motion, as the root [MediaQuery] carries it: the device's own setting or the learner's
/// (Settings › Display). Everything that moves on its own asks here.
extension MotionContext on BuildContext {
  bool get reduceMotion => MediaQuery.disableAnimationsOf(this);
}

extension MotionWidget on Widget {
  /// This widget with [effects] (fades, slides, scales), unless reduced motion is on: then the widget as it is.
  Widget withMotion(BuildContext context, Animate Function(Animate animate) effects) => context.reduceMotion ? this : effects(animate());
}

/// Page transitions that stand still under reduced motion: the new page simply appears.
class MotionAwarePageTransitions extends PageTransitionsBuilder {
  const MotionAwarePageTransitions(this.base);

  final PageTransitionsBuilder base;

  /// The platform's own transitions ([PageTransitionsTheme]'s defaults), each made motion-aware.
  static PageTransitionsTheme theme() => PageTransitionsTheme(
    builders: {for (final MapEntry(:key, :value) in const PageTransitionsTheme().builders.entries) key: MotionAwarePageTransitions(value)},
  );

  @override
  Duration get transitionDuration => base.transitionDuration;

  @override
  Duration get reverseTransitionDuration => base.reverseTransitionDuration;

  @override
  DelegatedTransitionBuilder? get delegatedTransition {
    final delegated = base.delegatedTransition;
    if (delegated == null) return null;
    return (context, animation, secondaryAnimation, allowSnapshotting, child) =>
        MediaQuery.disableAnimationsOf(context) ? child : delegated(context, animation, secondaryAnimation, allowSnapshotting, child);
  }

  @override
  Widget buildTransitions<T>(PageRoute<T> route, BuildContext context, Animation<double> animation, Animation<double> secondaryAnimation, Widget child) =>
      MediaQuery.disableAnimationsOf(context) ? child : base.buildTransitions(route, context, animation, secondaryAnimation, child);
}
