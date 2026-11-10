import 'package:flutter/material.dart';

import '../content/content_models.dart';
import 'colors.dart';

/// Dynamic Course Accent tokens (U2 "Night Market").
/// Derives the 3 lantern hues, action buttons, and glowing rings from the course cover recipe
/// (`@langquest/ui` COVER_RECIPES, carried by the content bundle).
class CourseAccent {
  final String? trackId;
  final List<double> hues;
  final List<Color> lantern;
  final Color primary;
  final Color primaryStrong;
  final Color primarySoft;
  final Color onPrimary;
  final Color primaryText;
  final Color ring;
  final bool tinted;

  const CourseAccent({
    this.trackId,
    required this.hues,
    required this.lantern,
    required this.primary,
    required this.primaryStrong,
    required this.primarySoft,
    required this.onPrimary,
    required this.primaryText,
    required this.ring,
    required this.tinted,
  });

  static Color hslToColor(double h, double s, double l, [double a = 1.0]) {
    return HSLColor.fromAHSL(a, (h % 360), s.clamp(0.0, 1.0), l.clamp(0.0, 1.0)).toColor();
  }

  /// WCAG contrast ratio between two opaque colors.
  static double contrast(Color a, Color b) {
    final la = a.computeLuminance();
    final lb = b.computeLuminance();
    final hi = la > lb ? la : lb;
    final lo = la > lb ? lb : la;
    return (hi + 0.05) / (lo + 0.05);
  }

  static const _ink = Color(0xFF130F21);

  /// White or Night Market ink, whichever reads better on [background] (labels on course-coloured buttons).
  static Color readableOn(Color background) => contrast(Colors.white, background) >= contrast(_ink, background) ? Colors.white : _ink;

  /// [fill], darkened or lightened just enough (toward the side its label already reads best on) for that label to
  /// reach [ratio] — WCAG AA for text. Mid-tone hues fall short with both white and ink labels.
  static Color readableFill(Color fill, {double ratio = 4.5}) {
    final hsl = HSLColor.fromColor(fill);
    final darker = readableOn(fill) == Colors.white;
    var color = fill;
    for (var step = 1; step <= 50 && contrast(color, readableOn(color)) < ratio; step++) {
      color = hsl.withLightness((hsl.lightness + (darker ? -0.01 : 0.01) * step).clamp(0.0, 1.0)).toColor();
    }
    return color;
  }

  /// The accent of [track], or the neutral Night Market accent when no course is active.
  static CourseAccent forTrack(CourseTrackInfo? track, {bool isDark = true}) {
    if (track == null) {
      final base = isDark ? LangQuestColors.dark : LangQuestColors.light;
      return CourseAccent(
        trackId: null,
        hues: const [330.0, 183.0, 42.0],
        lantern: base.lantern,
        primary: base.accent,
        primaryStrong: base.accentStrong,
        primarySoft: base.accentSoft,
        onPrimary: base.onAccent,
        primaryText: base.accentText,
        ring: base.accent,
        tinted: false,
      );
    }

    final h1 = track.cover.hue;
    final h2 = track.cover.hue2;
    final h3 = (track.cover.hue + 150.0 + track.cover.variant * 12.0) % 360.0;

    final sat = isDark ? 0.95 : 0.82;
    final lit = isDark ? 0.60 : 0.46;

    final lantern = [hslToColor(h1, sat, lit), hslToColor(h2, sat, lit), hslToColor(h3, sat, lit)];

    final primary = readableFill(hslToColor(h1, isDark ? 0.92 : 0.85, isDark ? 0.58 : 0.40));
    final primaryStrong = hslToColor(h1, isDark ? 0.95 : 0.90, isDark ? 0.65 : 0.34);
    final primarySoft = hslToColor(h1, isDark ? 0.40 : 0.25, isDark ? 0.16 : 0.92, isDark ? 0.35 : 0.8);
    final primaryText = hslToColor(h1, isDark ? 0.88 : 0.90, isDark ? 0.72 : 0.32);
    final onPrimary = readableOn(primary);

    return CourseAccent(
      trackId: track.id,
      hues: [h1, h2, h3],
      lantern: lantern,
      primary: primary,
      primaryStrong: primaryStrong,
      primarySoft: primarySoft,
      onPrimary: onPrimary,
      primaryText: primaryText,
      ring: primary,
      tinted: true,
    );
  }
}
