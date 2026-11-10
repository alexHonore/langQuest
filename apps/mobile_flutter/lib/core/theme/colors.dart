import 'package:flutter/material.dart';

/// Night Market semantic color tokens (design direction U2).
/// WCAG AA compliant on all surfaces with rich lantern glows and glassmorphism.
class LangQuestColors {
  final Color background;
  final Color surface;
  final Color elevated;
  final Color surfaceMuted;
  final Color textPrimary;
  final Color textSecondary;
  final Color textMuted;
  final Color onAccent;
  final Color accent;
  final Color accentStrong;
  final Color accentSoft;
  final Color accentText;
  final Color amber;
  final Color amberText;
  final Color onAmber;
  final Color cyan;
  final Color cyanText;
  final Color onCyan;
  final Color success;
  final Color successSoft;
  final Color warning;
  final Color warningSoft;
  final Color error;
  final Color errorSoft;
  final Color info;
  final Color infoSoft;
  final Color border;
  final Color borderStrong;
  final Color focusRing;
  final Color overlay;
  final Color sceneScrim;
  final Color onScrim;
  final Color celebrationA;
  final Color celebrationB;
  final Color celebrationC;
  final List<Color> lantern;
  final GlassColors glass;
  final SpeechStateColors speech;

  const LangQuestColors({
    required this.background,
    required this.surface,
    required this.elevated,
    required this.surfaceMuted,
    required this.textPrimary,
    required this.textSecondary,
    required this.textMuted,
    required this.onAccent,
    required this.accent,
    required this.accentStrong,
    required this.accentSoft,
    required this.accentText,
    required this.amber,
    required this.amberText,
    required this.onAmber,
    required this.cyan,
    required this.cyanText,
    required this.onCyan,
    required this.success,
    required this.successSoft,
    required this.warning,
    required this.warningSoft,
    required this.error,
    required this.errorSoft,
    required this.info,
    required this.infoSoft,
    required this.border,
    required this.borderStrong,
    required this.focusRing,
    required this.overlay,
    required this.sceneScrim,
    required this.onScrim,
    required this.celebrationA,
    required this.celebrationB,
    required this.celebrationC,
    required this.lantern,
    required this.glass,
    required this.speech,
  });

  static const LangQuestColors dark = LangQuestColors(
    background: Color(0xFF0B0913),
    surface: Color(0xFF130F21),
    elevated: Color(0xFF1C1730),
    surfaceMuted: Color(0xFF262038),
    textPrimary: Color(0xFFF5F2FB),
    textSecondary: Color(0xFFBDB6D0),
    textMuted: Color(0xFF9A93B1),
    onAccent: Color(0xFF2A0718),
    accent: Color(0xFFFF4FA3),
    accentStrong: Color(0xFFFF6DB4),
    accentSoft: Color(0xFF3C1230),
    accentText: Color(0xFFFF7CBB),
    amber: Color(0xFFFFB547),
    amberText: Color(0xFFFFC46A),
    onAmber: Color(0xFF2B1A00),
    cyan: Color(0xFF3EE1E8),
    cyanText: Color(0xFF5FE9EF),
    onCyan: Color(0xFF04282B),
    success: Color(0xFF45E0A6),
    successSoft: Color(0xFF0F3328),
    warning: Color(0xFFFFC46A),
    warningSoft: Color(0xFF3A2A0E),
    error: Color(0xFFFF8A96),
    errorSoft: Color(0xFF45191F),
    info: Color(0xFF5FE9EF),
    infoSoft: Color(0xFF0D3236),
    border: Color(0xFF2B2739),
    borderStrong: Color(0xFF817A9B),
    focusRing: Color(0xFF3EE1E8),
    overlay: Color(0xB80B0913),
    sceneScrim: Color(0x8C0B0913),
    onScrim: Color(0xFFF5F2FB),
    celebrationA: Color(0xFFFF4FA3),
    celebrationB: Color(0xFFFFB547),
    celebrationC: Color(0xFF3EE1E8),
    lantern: [Color(0xFFFF4FA3), Color(0xFF3EE1E8), Color(0xFFFFB547)],
    glass: GlassColors(
      fill: Color(0x0FFFFFFF),
      fillStrong: Color(0x1CFFFFFF),
      border: Color(0x21FFFFFF),
      borderStrong: Color(0x29FFFFFF),
      solid: Color(0xFF1A1821),
      solidStrong: Color(0xFF232030),
    ),
    speech: SpeechStateColors(
      listening: Color(0xFF5FE9EF),
      speaking: Color(0xFFFF7CBB),
      thinking: Color(0xFFC9B8FF),
      reconnecting: Color(0xFFFFC46A),
      error: Color(0xFFFF8A96),
    ),
  );

  static const LangQuestColors light = LangQuestColors(
    background: Color(0xFFF6F3FB),
    surface: Color(0xFFFFFFFF),
    elevated: Color(0xFFFCFBFE),
    surfaceMuted: Color(0xFFEDE8F7),
    textPrimary: Color(0xFF1A1430),
    textSecondary: Color(0xFF534B6C),
    textMuted: Color(0xFF675F82),
    onAccent: Color(0xFFFFFFFF),
    accent: Color(0xFFD1177C),
    accentStrong: Color(0xFFA30F62),
    accentSoft: Color(0xFFFDEAF4),
    accentText: Color(0xFFB0106A),
    amber: Color(0xFFC96F00),
    amberText: Color(0xFF8A4B00),
    onAmber: Color(0xFF1F1200),
    cyan: Color(0xFF0B7A82),
    cyanText: Color(0xFF0A6E77),
    onCyan: Color(0xFFFFFFFF),
    success: Color(0xFF0D6B45),
    successSoft: Color(0xFFDCF4E8),
    warning: Color(0xFF8A4B00),
    warningSoft: Color(0xFFFFF0D6),
    error: Color(0xFFC0283A),
    errorSoft: Color(0xFFFCE3E5),
    info: Color(0xFF0A6E77),
    infoSoft: Color(0xFFDCF3F5),
    border: Color(0xFFDAD4E6),
    borderStrong: Color(0xFF6F678A),
    focusRing: Color(0xFF0B7A82),
    overlay: Color(0x9E1A1430),
    sceneScrim: Color(0x731A1430),
    onScrim: Color(0xFFFFFFFF),
    celebrationA: Color(0xFFD1177C),
    celebrationB: Color(0xFFC96F00),
    celebrationC: Color(0xFF0B7A82),
    lantern: [Color(0xFFD1177C), Color(0xFF0B7A82), Color(0xFFC96F00)],
    glass: GlassColors(
      fill: Color(0xA8FFFFFF),
      fillStrong: Color(0xDBFFFFFF),
      border: Color(0x141A1430),
      borderStrong: Color(0x1F1A1430),
      solid: Color(0xFFFCFBFE),
      solidStrong: Color(0xFFFFFFFF),
    ),
    speech: SpeechStateColors(
      listening: Color(0xFF0A6E77),
      speaking: Color(0xFFB0106A),
      thinking: Color(0xFF5B45C4),
      reconnecting: Color(0xFF8A4B00),
      error: Color(0xFFC0283A),
    ),
  );
}

class GlassColors {
  final Color fill;
  final Color fillStrong;
  final Color border;
  final Color borderStrong;
  final Color solid;
  final Color solidStrong;

  const GlassColors({
    required this.fill,
    required this.fillStrong,
    required this.border,
    required this.borderStrong,
    required this.solid,
    required this.solidStrong,
  });
}

class SpeechStateColors {
  final Color listening;
  final Color speaking;
  final Color thinking;
  final Color reconnecting;
  final Color error;

  const SpeechStateColors({
    required this.listening,
    required this.speaking,
    required this.thinking,
    required this.reconnecting,
    required this.error,
  });
}
