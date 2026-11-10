// Reads the content bundle from disk (dart:io): VM only.
@TestOn('vm')
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:langquest_mobile/features/learn/learn_widgets.dart';

import 'support.dart';

void main() {
  test('BCP-47 tags become locales (region, numeric region, script)', () {
    expect(localeFromTag('es-ES'), const Locale('es', 'ES'));
    expect(localeFromTag('es-419'), const Locale('es', '419'));
    expect(localeFromTag('ar'), const Locale('ar'));
    expect(localeFromTag('zh-Hant-HK'), const Locale.fromSubtags(languageCode: 'zh', scriptCode: 'Hant', countryCode: 'HK'));
    expect(localeFromTag('pt_br'), const Locale('pt', 'BR'));
  });

  for (final (trackId, locale) in const [('spanish-spain', Locale('es', 'ES')), ('arabic-moroccan', Locale('ar', 'MA')), ('japanese', Locale('ja', 'JP'))]) {
    testWidgets('a $trackId phrase is marked as ${locale.toLanguageTag()} for screen readers, not as the interface language', (tester) async {
      final semantics = tester.ensureSemantics();
      final track = testBundle.track(trackId)!;
      final expression = testBundle.chapters.where((c) => c.courseTrackId == track.id).expand((c) => c.missions).first.expressions.first;
      await tester.pumpWidget(
        ProviderScope(
          overrides: await testOverrides(),
          child: MaterialApp(
            home: Scaffold(body: TargetText(expression: expression, track: track)),
          ),
        ),
      );
      expect(tester.getSemantics(find.text(expression.text)).getSemanticsData().locale, locale);
      semantics.dispose();
    });
  }
}
