import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../constants/catalog.dart';
import 'colors.dart';

/// Dynamic Course Accent tokens (U2 "Night Market").
/// Derives the 3 lantern hues, action buttons, and glowing rings from the course cover recipe.
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

  static CourseAccent forTrack(String? trackId, {bool isDark = true}) {
    if (trackId == null) {
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

    final track = CatalogConstants.getTrack(trackId);
    final h1 = track.hue;
    final h2 = track.hue2;
    final h3 = (track.hue + 150.0 + track.variant * 12.0) % 360.0;

    final sat = isDark ? 0.95 : 0.82;
    final lit = isDark ? 0.60 : 0.46;

    final lantern = [
      hslToColor(h1, sat, lit),
      hslToColor(h2, sat, lit),
      hslToColor(h3, sat, lit),
    ];

    final primary = hslToColor(h1, isDark ? 0.92 : 0.85, isDark ? 0.58 : 0.44);
    final primaryStrong = hslToColor(h1, isDark ? 0.95 : 0.90, isDark ? 0.65 : 0.38);
    final primarySoft = hslToColor(h1, isDark ? 0.40 : 0.25, isDark ? 0.16 : 0.92, isDark ? 0.35 : 0.8);
    final primaryText = hslToColor(h1, isDark ? 0.88 : 0.90, isDark ? 0.72 : 0.36);
    final onPrimary = isDark ? const Color(0xFF130F21) : Colors.white;

    return CourseAccent(
      trackId: trackId,
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
