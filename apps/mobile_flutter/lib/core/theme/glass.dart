import 'dart:ui';
import 'package:flutter/material.dart';
import 'colors.dart';

enum GlassLevel { level1, level2, level3 }

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
    final colors = LangQuestColors.dark;

    final double blurSigma = switch (level) {
      GlassLevel.level1 => 12.0,
      GlassLevel.level2 => 20.0,
      GlassLevel.level3 => 30.0,
    };

    final Color fillColor = switch (level) {
      GlassLevel.level1 => const Color(0x12FFFFFF),
      GlassLevel.level2 => const Color(0x1AFFFFFF),
      GlassLevel.level3 => const Color(0x28FFFFFF),
    };

    final Color borderColor = switch (level) {
      GlassLevel.level1 => const Color(0x22FFFFFF),
      GlassLevel.level2 => const Color(0x30FFFFFF),
      GlassLevel.level3 => const Color(0x40FFFFFF),
    };

    Widget content = ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: blurSigma, sigmaY: blurSigma),
        child: Container(
          padding: padding ?? const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: fillColor,
            borderRadius: BorderRadius.circular(radius),
            border: border ?? Border.all(color: borderColor, width: 1.0),
            boxShadow: customGlow != null
                ? [
                    BoxShadow(
                      color: customGlow!.withOpacity(0.25),
                      blurRadius: 18,
                      spreadRadius: 2,
                    ),
                  ]
                : null,
          ),
          child: child,
        ),
      ),
    );

    if (onTap != null) {
      content = GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: content,
      );
    }

    if (margin != null) {
      content = Padding(padding: margin!, child: content);
    }

    return content;
  }
}
