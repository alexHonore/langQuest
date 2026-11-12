import 'dart:ui';

import 'package:flutter/material.dart';

import 'colors.dart';

enum GlassLevel { level1, level2, level3 }

/// Night Market glass card. Reads the theme's brightness so the same card is a translucent dark pane in the dark
/// palette and a frosted white pane (with a hairline border and soft shadow) in the light one.
class GlassContainer extends StatelessWidget {
  final Widget child;
  final GlassLevel level;
  final double radius;
  final EdgeInsetsGeometry? padding;
  final EdgeInsetsGeometry? margin;
  final Border? border;
  final Color? customGlow;
  final VoidCallback? onTap;

  const GlassContainer({
    super.key,
    required this.child,
    this.level = GlassLevel.level1,
    this.radius = 16,
    this.padding,
    this.margin,
    this.border,
    this.customGlow,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final glass = (isDark ? LangQuestColors.dark : LangQuestColors.light).glass;

    final double blurSigma = switch (level) {
      GlassLevel.level1 => 12.0,
      GlassLevel.level2 => 20.0,
      GlassLevel.level3 => 30.0,
    };

    final Color fillColor = isDark
        ? switch (level) {
            GlassLevel.level1 => const Color(0x12FFFFFF),
            GlassLevel.level2 => const Color(0x1AFFFFFF),
            GlassLevel.level3 => const Color(0x28FFFFFF),
          }
        : switch (level) {
            GlassLevel.level1 => glass.fill,
            GlassLevel.level2 => glass.fillStrong,
            GlassLevel.level3 => glass.solidStrong.withValues(alpha: 0.94),
          };

    final Color borderColor = isDark
        ? switch (level) {
            GlassLevel.level1 => const Color(0x22FFFFFF),
            GlassLevel.level2 => const Color(0x30FFFFFF),
            GlassLevel.level3 => const Color(0x40FFFFFF),
          }
        : (level == GlassLevel.level1 ? glass.border : glass.borderStrong);

    final shadows = <BoxShadow>[
      if (customGlow != null) BoxShadow(color: customGlow!.withValues(alpha: isDark ? 0.25 : 0.18), blurRadius: 18, spreadRadius: 2),
      if (!isDark && customGlow == null) const BoxShadow(color: Color(0x141A1430), blurRadius: 14, offset: Offset(0, 4)),
    ];

    // The glow/shadow sits outside the clip so it is not cut off by the rounded corners.
    Widget content = DecoratedBox(
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(radius), boxShadow: shadows.isEmpty ? null : shadows),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(radius),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: blurSigma, sigmaY: blurSigma),
          child: Container(
            padding: padding ?? const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: fillColor,
              borderRadius: BorderRadius.circular(radius),
              border: border ?? Border.all(color: borderColor, width: 1.0),
            ),
            child: child,
          ),
        ),
      ),
    );

    if (onTap != null) {
      content = GestureDetector(onTap: onTap, behavior: HitTestBehavior.opaque, child: content);
    }

    if (margin != null) {
      content = Padding(padding: margin!, child: content);
    }

    return content;
  }
}

/// A lantern's glow behind a screen's content: light in [color] that fades out to nothing (Night Market's ambient
/// bloom). Decorative: it takes no taps.
class LanternBloom extends StatelessWidget {
  const LanternBloom({super.key, required this.color, required this.size});

  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) => IgnorePointer(
    child: Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: RadialGradient(
          colors: [
            color,
            color.withValues(alpha: color.a * 0.45),
            color.withValues(alpha: 0),
          ],
          stops: const [0, 0.45, 1],
        ),
      ),
    ),
  );
}
