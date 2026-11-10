// Reads the content bundle from disk (dart:io): VM only.
@TestOn('vm')
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:langquest_mobile/core/content/content_models.dart';
import 'package:langquest_mobile/core/theme/accents.dart';
import 'package:langquest_mobile/core/theme/app_theme.dart';
import 'package:langquest_mobile/core/theme/colors.dart';

import 'support.dart';

void main() {
  // Every course accent of the catalog, plus the neutral one (no course yet: the first run), in both themes.
  final tracks = <CourseTrackInfo?>[null, ...testBundle.tracks];

  test('labels on course-coloured fills are readable (WCAG AA, 4.5:1) for every course, light and dark', () {
    final failures = <String>[];
    for (final isDark in [true, false]) {
      final colors = isDark ? LangQuestColors.dark : LangQuestColors.light;
      for (final track in tracks) {
        final scheme = buildAppTheme(colors, CourseAccent.forTrack(track, isDark: isDark), isDark: isDark).colorScheme;
        final pairs = {
          'primary': (scheme.primary, scheme.onPrimary),
          'secondary': (scheme.secondary, scheme.onSecondary),
          'selected segment / chip': (scheme.secondaryContainer, scheme.onSecondaryContainer),
        };
        for (final MapEntry(key: role, value: (fill, label)) in pairs.entries) {
          final ratio = CourseAccent.contrast(fill, label);
          if (ratio < 4.5) failures.add('${track?.id ?? 'no course'} ${isDark ? 'dark' : 'light'} $role: ${ratio.toStringAsFixed(2)}');
        }
      }
    }
    expect(failures, isEmpty);
  });

  testWidgets('the selected language on the first screen is not white on cyan', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildAppTheme(LangQuestColors.dark, CourseAccent.forTrack(null), isDark: true),
        home: Scaffold(
          body: SegmentedButton<String>(
            segments: const [ButtonSegment(value: 'en', label: Text('English')), ButtonSegment(value: 'fr', label: Text('Français'))],
            selected: const {'en'},
            showSelectedIcon: false,
            onSelectionChanged: (_) {},
          ),
        ),
      ),
    );
    final label = tester.widget<RichText>(find.descendant(of: find.text('English'), matching: find.byType(RichText)));
    final labelColor = label.text.style!.color!;
    expect(CourseAccent.contrast(labelColor, LangQuestColors.dark.lantern[1]), greaterThanOrEqualTo(4.5));
  });
}
