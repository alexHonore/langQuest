import 'package:flutter/material.dart';

import 'accents.dart';
import 'colors.dart';
import 'typography.dart';

/// The Material theme for the active course accent and light/dark tokens.
///
/// Labels on course-coloured fills (buttons, the selected segment of the language switch, the selected chip) use
/// [CourseAccent.readableOn] on a [CourseAccent.readableFill]: the lantern hues are bright in the dark theme, where white
/// text would be unreadable, and a few mid-tone hues need a slightly darker or lighter fill.
ThemeData buildAppTheme(LangQuestColors colors, CourseAccent accent, {required bool isDark}) {
  final brightness = isDark ? Brightness.dark : Brightness.light;
  final secondary = CourseAccent.readableFill(accent.lantern[1]);
  final onSecondary = CourseAccent.readableOn(secondary);
  return ThemeData(
    brightness: brightness,
    scaffoldBackgroundColor: colors.background,
    colorScheme: ColorScheme(
      brightness: brightness,
      primary: accent.primary,
      onPrimary: accent.onPrimary,
      secondary: secondary,
      onSecondary: onSecondary,
      // Selected SegmentedButton segment and ChoiceChip.
      secondaryContainer: secondary,
      onSecondaryContainer: onSecondary,
      error: colors.error,
      onError: colors.background,
      surface: colors.surface,
      onSurface: colors.textPrimary,
      surfaceContainerHighest: colors.surfaceMuted,
      outline: colors.borderStrong,
      outlineVariant: colors.border,
    ),
    textTheme: LangQuestTypography.createTextTheme(colors),
    appBarTheme: AppBarTheme(backgroundColor: colors.background, elevation: 0),
    dialogTheme: DialogThemeData(backgroundColor: colors.elevated),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: colors.textPrimary,
      contentTextStyle: TextStyle(color: colors.background, fontSize: 14),
      behavior: SnackBarBehavior.floating,
    ),
  );
}
