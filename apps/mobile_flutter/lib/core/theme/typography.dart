import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'colors.dart';
import 'script_fonts.dart';

/// The display face (Outfit) for titles and numbers: the bundled weights only (semi-bold, bold), with the script
/// fonts behind it for names in other scripts.
TextStyle displayStyle({required double size, required Color color, bool bold = true, double height = 1.15, double letterSpacing = -0.2}) =>
    GoogleFonts.outfit(
      fontSize: size,
      fontWeight: bold ? FontWeight.w700 : FontWeight.w600,
      color: color,
      height: height,
      letterSpacing: letterSpacing,
    ).copyWith(fontFamilyFallback: scriptFontFallback);

class LangQuestTypography {
  static TextTheme createTextTheme(LangQuestColors colors) {
    return TextTheme(
      displayLarge: GoogleFonts.outfit(
        fontSize: 32,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.5,
        color: colors.textPrimary,
      ),
      displayMedium: GoogleFonts.outfit(
        fontSize: 26,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.3,
        color: colors.textPrimary,
      ),
      displaySmall: GoogleFonts.outfit(
        fontSize: 22,
        fontWeight: FontWeight.w600,
        color: colors.textPrimary,
      ),
      headlineMedium: GoogleFonts.outfit(
        fontSize: 18,
        fontWeight: FontWeight.w600,
        color: colors.textPrimary,
      ),
      headlineSmall: GoogleFonts.outfit(
        fontSize: 16,
        fontWeight: FontWeight.w600,
        color: colors.textPrimary,
      ),
      titleLarge: GoogleFonts.inter(
        fontSize: 16,
        fontWeight: FontWeight.w600,
        color: colors.textPrimary,
      ),
      titleMedium: GoogleFonts.inter(
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: colors.textPrimary,
      ),
      bodyLarge: GoogleFonts.inter(
        fontSize: 15,
        fontWeight: FontWeight.w400,
        height: 1.45,
        color: colors.textPrimary,
      ),
      bodyMedium: GoogleFonts.inter(
        fontSize: 13,
        fontWeight: FontWeight.w400,
        height: 1.4,
        color: colors.textSecondary,
      ),
      labelLarge: GoogleFonts.inter(
        fontSize: 13,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.2,
        color: colors.textPrimary,
      ),
      labelSmall: GoogleFonts.inter(
        fontSize: 11,
        fontWeight: FontWeight.w500,
        color: colors.textMuted,
      ),
    );
  }
}
