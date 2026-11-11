// Reads the content bundle and the bundled recordings from disk (dart:io): VM only.
@TestOn('vm')
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:langquest_mobile/core/content/real_examples.dart';
import 'package:langquest_mobile/l10n/generated/app_localizations.dart';
import 'package:langquest_mobile/features/learn/real_examples_sheet.dart';

import 'support.dart';

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);
  final examples = testBundle.examples;
  final phrases = {
    for (final c in testBundle.chapters)
      for (final m in c.missions)
        for (final e in m.expressions) e.id: (c, e),
  };

  test('real examples from Tatoeba: each belongs to a bundled phrase, in the course\'s instruction languages, attributed', () {
    expect(examples.snapshot, isNotEmpty);
    expect(examples.textLicense, 'CC BY 2.0 FR');
    expect(examples.phrases.length, greaterThan(40), reason: 'most courses have real examples');
    for (final MapEntry(key: id, value: found) in examples.phrases.entries) {
      final hit = phrases[id];
      expect(hit, isNotNull, reason: '$id is not a bundled phrase');
      final (chapter, expression) = hit!;
      for (final e in [?found.attested, ...found.examples]) {
        expect(int.tryParse(e.id), isNotNull, reason: 'a Tatoeba sentence id');
        expect(e.translations.keys.toSet().difference(chapter.sourceLanguages.toSet()), isEmpty, reason: '$id: translations only in the course\'s languages');
      }
      for (final e in found.examples) {
        expect(e.translations, isNotEmpty, reason: '$id: an example is always translated');
        expect(e.text, isNot(expression.text));
      }
    }
    expect(examples.untaggedVariety, contains('spanish-spain'), reason: 'Tatoeba does not say which country a Spanish sentence comes from');
    expect(examples.untaggedVariety, isNot(contains('japanese')));
  });

  test('every recording offered is bundled, and only under a license allowing redistribution', () {
    final recordings = [
      for (final found in examples.phrases.values)
        for (final e in [?found.attested, ...found.examples]) ?e.recording,
    ];
    expect(recordings, isNotEmpty);
    for (final r in recordings) {
      expect(File(r.asset).existsSync(), isTrue, reason: '${r.asset} is missing');
      expect(r.license, matches(RegExp(r'^(CC BY( |-SA )\d|CC0)')), reason: r.license);
      expect(r.license, isNot(contains('NC')));
    }
  });

  testWidgets('the sheet: the phrase as written by a contributor, examples with their translation, credits', (t) async {
    t.view.physicalSize = const Size(390 * 3, 844 * 3);
    t.view.devicePixelRatio = 3;
    addTearDown(t.view.reset);
    final entry = examples.phrases.entries.firstWhere((e) {
      final (chapter, _) = phrases[e.key]!;
      return chapter.courseTrackId == 'spanish-spain' && e.value.attested != null && e.value.readableIn('en').isNotEmpty;
    });
    final (chapter, expression) = phrases[entry.key]!;
    await t.pumpWidget(
      ProviderScope(
        overrides: await testOverrides(),
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: Center(
              child: RealExamplesButton(expression: expression, track: testBundle.track(chapter.courseTrackId)!, source: 'en'),
            ),
          ),
        ),
      ),
    );
    await t.tap(find.text('Real examples'));
    await t.pumpAndSettle();
    expect(find.text('Sentences written by Tatoeba contributors that use “${expression.text}”.'), findsOneWidget);
    expect(find.text('“${expression.text}” is itself a Tatoeba sentence: people really say it this way.'), findsOneWidget);
    final example = entry.value.readableIn('en').first;
    expect(find.text(example.text), findsOneWidget);
    expect(find.text(example.translationIn('en')!), findsOneWidget);
    expect(find.textContaining('Tatoeba #${example.id}'), findsOneWidget);
    expect(find.textContaining('Tatoeba doesn’t record which country'), findsOneWidget);
    expect(find.text('From Tatoeba (tatoeba.org), sentences under CC BY 2.0 FR, export of ${examples.snapshot}.'), findsOneWidget);
  });

  test('a phrase without anything readable in the learner\'s language gets no button', () {
    const found = PhraseExamples(
      examples: [
        RealExample(id: '1', text: 'x', author: null, translations: {'fr': 'y'}),
      ],
    );
    expect(found.readableIn('en'), isEmpty);
    expect(found.readableIn('fr'), hasLength(1));
  });
}
