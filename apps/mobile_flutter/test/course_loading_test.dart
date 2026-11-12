// Reads the content bundle from disk (dart:io): VM only.
@TestOn('vm')
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:langquest_mobile/core/content/content_bundle.dart';
import 'package:langquest_mobile/core/content/content_models.dart';
import 'package:langquest_mobile/core/services/app_state.dart';
import 'package:langquest_mobile/core/services/learner_state.dart';
import 'package:langquest_mobile/core/services/learner_store.dart';
import 'package:langquest_mobile/main.dart';
import 'package:langquest_mobile/navigation/app_router.dart';

import 'support.dart';

/// The package's assets, read as the app reads them; logs every path, fails the [failing] ones, and holds a read
/// back while [hold] is not completed.
class LoggingReader {
  final reads = <String>[];
  final failing = <String>{};
  Completer<void>? hold;

  Future<String> call(String path) async {
    reads.add(path);
    if (hold case final h?) await h.future;
    if (failing.contains(path)) throw FlutterError('Unable to load asset: "$path".');
    return File(path).readAsStringSync();
  }

  List<String> get chapterReads => [
    for (final p in reads)
      if (p.startsWith('assets/content/chapters/')) p,
  ];
}

String chapters(String trackId) => ContentBundle.chaptersAsset(trackId);

/// Pump frames for [ms] (the app has endless ambient animations, so `pumpAndSettle` would never return).
Future<void> settle(WidgetTester t, [int ms = 900]) async {
  for (var i = 0; i < ms ~/ 100; i++) {
    await t.pump(const Duration(milliseconds: 100));
  }
}

Future<void> tapText(WidgetTester t, String text) async {
  final f = find.text(text);
  expect(f, findsWidgets, reason: 'no "$text" on screen');
  await t.ensureVisible(f.first);
  await t.tap(f.first);
  await settle(t);
}

ProviderContainer containerOf(WidgetTester t) => ProviderScope.containerOf(t.element(find.byType(LangQuestApp)));

void usePhone(WidgetTester t, {double width = 390, double height = 844}) {
  t.view.physicalSize = Size(width * 3, height * 3);
  t.view.devicePixelRatio = 3;
  addTearDown(t.view.reset);
}

Map<String, Object> enrolledIn(String trackId, String source) => {
  LearnerStore.key: jsonEncode(
    LearnerState(
      enrollments: [Enrollment(trackId: trackId, source: source, enrolledAt: DateTime.utc(2026, 11, 1))],
      activeCourseId: courseIdFor(trackId, source),
    ).toJson(),
  ),
};

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  group('start-up', () {
    test('without a course: the catalog and the shared files only; every course is offered from the catalog', () async {
      final reader = LoggingReader();
      final bundle = await ContentBundle.load(reader.call);
      expect(reader.reads.toSet(), {
        ContentBundle.catalogAsset,
        ContentBundle.skillsAsset,
        ContentBundle.castAsset,
        ContentBundle.examplesAsset,
        ContentBundle.voicesAsset,
      });
      expect(bundle.chapters, isEmpty);
      expect([for (final t in bundle.availableFrom('en')) t.id], [for (final t in testBundle.availableFrom('en')) t.id]);
      expect([for (final t in bundle.availableFrom('fr')) t.id], [for (final t in testBundle.availableFrom('fr')) t.id]);
      expect(bundle.isAvailable('spanish-spain', 'en'), isTrue);
      expect(bundle.isAvailable('french', 'fr'), isFalse, reason: 'French is taught from English only');
      expect(bundle.track('spanish-spain')!.missionsFrom('en'), 6);
      expect(bundle.isLoaded('spanish-spain'), isFalse);
      expect(bundle.course('spanish-spain', 'en'), isNull, reason: 'its chapters are not read yet');
      expect(bundle.isLoaded('klingon'), isFalse);
    });

    test('with the learner\'s courses: exactly their chapter files (an unknown one is skipped)', () async {
      final reader = LoggingReader();
      final bundle = await ContentBundle.load(reader.call, courses: ['spanish-spain', 'arabic-moroccan', 'klingon']);
      expect(reader.chapterReads.toSet(), {chapters('spanish-spain'), chapters('arabic-moroccan')});
      expect({for (final c in bundle.chapters) c.courseTrackId}, {'spanish-spain', 'arabic-moroccan'});
      expect(bundle.course('spanish-spain', 'en')!.missions.length, 6);
      expect(bundle.course('arabic-moroccan', 'fr')!.hasContent, isTrue);
      expect(bundle.mission('es_greet_and_introduce'), isNotNull);
      expect(bundle.mission('ja_greet_and_introduce'), isNull, reason: 'Japanese was not read');
    });

    test('a course that cannot be read does not stop start-up; it is read when asked again', () async {
      final reader = LoggingReader()..failing.add(chapters('japanese'));
      final bundle = await ContentBundle.load(reader.call, courses: ['japanese', 'spanish-spain']);
      expect(bundle.isLoaded('japanese'), isFalse);
      expect(bundle.isLoaded('spanish-spain'), isTrue);

      final container = ProviderContainer(overrides: [contentBundleProvider.overrideWith(() => ContentNotifier(bundle, read: reader.call))]);
      addTearDown(container.dispose);
      final notifier = container.read(contentBundleProvider.notifier);
      await expectLater(notifier.loadCourse('japanese'), throwsA(isA<FlutterError>()));
      reader.failing.clear();
      await notifier.loadCourse('japanese');
      final content = container.read(contentBundleProvider);
      expect(content.course('japanese', 'en')!.hasContent, isTrue);
      expect(content.course('spanish-spain', 'en')!.hasContent, isTrue, reason: 'the courses read before stay');
    });
  });

  group('the catalog and the course files', () {
    test('agree: each course is offered from the languages its chapters have missions in, with their mission count', () {
      for (final t in testBundle.tracks) {
        final fromChapters = [
          for (final s in supportedInstructionLanguages)
            if (testBundle.chapters.any((c) => c.courseTrackId == t.id && c.sourceLanguages.contains(s) && c.missions.isNotEmpty)) s,
        ];
        expect(testBundle.sourcesFor(t.id), fromChapters, reason: t.id);
        for (final s in fromChapters) {
          expect(t.missionsFrom(s), testBundle.course(t.id, s)!.missions.length, reason: '${t.id} from $s');
        }
        expect(File(chapters(t.id)).existsSync(), testBundle.chapters.any((c) => c.courseTrackId == t.id), reason: t.id);
      }
      expect(File('assets/content/chapters.json').existsSync(), isFalse, reason: 'no file holds every course any more');
    });

    test('a course file holds that course only, in a schema the app knows', () {
      final spanish = File(chapters('spanish-spain')).readAsStringSync();
      expect(ContentBundle.parseCourse(spanish).trackId, 'spanish-spain');
      expect(() => ContentBundle.parseCourse(spanish.replaceFirst('"courseTrackId": "spanish-spain"', '"courseTrackId": "japanese"')), throwsFormatException);
      expect(() => ContentBundle.parseCourse('{"schemaVersion": 2, "courseTrackId": "japanese", "chapters": []}'), throwsFormatException);
    });

    test('loading a course: one read for calls at the same time, none once it is in memory; an unknown course fails', () async {
      final reader = LoggingReader();
      final empty = await ContentBundle.load(reader.call);
      reader.reads.clear();
      final lazy = ProviderContainer(overrides: [contentBundleProvider.overrideWith(() => ContentNotifier(empty, read: reader.call))]);
      addTearDown(lazy.dispose);
      final notifier = lazy.read(contentBundleProvider.notifier);
      await Future.wait([notifier.loadCourse('korean'), notifier.loadCourse('korean')]);
      expect(reader.chapterReads, [chapters('korean')]);
      await notifier.loadCourse('korean');
      expect(reader.chapterReads, hasLength(1));
      expect(lazy.read(contentBundleProvider).course('korean', 'en')!.hasContent, isTrue);
      await expectLater(notifier.loadCourse('klingon'), throwsArgumentError);
    });
  });

  group('app state', () {
    test('taking a course not read yet reads it; what the learner did meanwhile is kept when it arrives', () async {
      final reader = LoggingReader();
      final c = await testContainer(content: await ContentBundle.load(reader.call), read: reader.call);
      addTearDown(c.dispose);
      final n = c.read(appStateProvider.notifier);
      reader.hold = Completer();
      expect(n.enroll('french', 'fr'), isFalse, reason: 'from the catalog: French is taught from English only');
      expect(n.enroll('japanese', 'en'), isTrue);
      expect(c.read(appStateProvider).activeCourse, isNull, reason: 'its chapters are being read');
      n.setDarkMode(false);
      reader.hold!.complete();
      await n.loadCourse('japanese');

      final s = c.read(appStateProvider);
      expect(reader.chapterReads, [chapters('japanese')]);
      expect(s.activeCourse?.id, 'japanese|en');
      expect(s.nextMission(s.activeCourse!)?.key, testBundle.course('japanese', 'en')!.missions.first.key);
      expect(s.learner.isEnrolled('japanese', 'en'), isTrue);
      expect(s.isDark, isFalse, reason: 'a change made while the course was read is not lost');
    });
  });

  group('screens', () {
    testWidgets('first run on a fresh install: no course is read until one is opened, then only that one', (t) async {
      usePhone(t);
      final reader = LoggingReader();
      await t.pumpWidget(await testApp(content: await ContentBundle.load(reader.call), read: reader.call));
      await settle(t);
      await tapText(t, 'Choose a course');
      // The mission counts come from the catalog.
      expect(find.textContaining('7 missions'), findsWidgets);
      final courses = find.byType(Scrollable).first;
      await t.scrollUntilVisible(find.text('Spanish (Spain-Castilian)'), 300, scrollable: courses);
      expect(find.textContaining('6 missions'), findsWidgets);
      expect(reader.chapterReads, isEmpty);

      reader.hold = Completer();
      await t.tap(find.text('Spanish (Spain-Castilian)'));
      await settle(t);
      expect(find.bySemanticsLabel('Loading the course…'), findsOneWidget);
      expect(find.text('Start this course'), findsNothing);
      reader.hold!.complete();
      await settle(t);
      expect(find.text('Mission pathway (6 missions)'), findsOneWidget);
      expect(reader.chapterReads, [chapters('spanish-spain')]);

      await tapText(t, 'Start this course');
      expect(containerOf(t).read(appStateProvider).activeCourse?.id, 'spanish-spain|en');
      expect(find.text('Hola, buenos días.'), findsOneWidget, reason: 'the warm-up has its first phrase at once');
      expect(reader.chapterReads, [chapters('spanish-spain')]);
    });

    testWidgets('a course that cannot be read says so and offers to try again', (t) async {
      usePhone(t);
      final reader = LoggingReader()..failing.add(chapters('japanese'));
      await t.pumpWidget(await testApp(content: await ContentBundle.load(reader.call), read: reader.call));
      await settle(t);
      containerOf(t).read(appRouterProvider).push('/course/japanese');
      await settle(t);
      expect(find.text('This course could not be loaded. Check your connection and try again.'), findsOneWidget);
      expect(find.text('Start this course'), findsNothing);

      reader.failing.clear();
      await tapText(t, 'Try again');
      expect(find.text('Start this course'), findsOneWidget);
      expect(find.text('Mission pathway (4 missions)'), findsOneWidget);
    });

    testWidgets('a learner whose course was read at start-up opens on Home', (t) async {
      usePhone(t);
      final reader = LoggingReader();
      final content = await ContentBundle.load(reader.call, courses: ['spanish-spain']);
      await t.pumpWidget(await testApp(prefs: enrolledIn('spanish-spain', 'en'), content: content, read: reader.call));
      await settle(t);
      expect(find.text('Greet and introduce yourself'), findsWidgets);
      expect(find.bySemanticsLabel('Loading the course…'), findsNothing);
      expect(reader.chapterReads, [chapters('spanish-spain')]);
    });

    testWidgets('a learner whose course could not be read at start-up sees it loading, a way to retry, then Home', (t) async {
      usePhone(t);
      final reader = LoggingReader()..failing.add(chapters('spanish-spain'));
      final content = await ContentBundle.load(reader.call, courses: ['spanish-spain']);
      expect(content.isLoaded('spanish-spain'), isFalse);
      await t.pumpWidget(await testApp(prefs: enrolledIn('spanish-spain', 'en'), content: content, read: reader.call));
      await settle(t);
      expect(find.text('This course could not be loaded. Check your connection and try again.'), findsOneWidget);
      expect(find.text('Greet and introduce yourself'), findsNothing);

      reader.failing.clear();
      reader.hold = Completer();
      await tapText(t, 'Try again');
      expect(find.bySemanticsLabel('Loading the course…'), findsOneWidget);
      reader.hold!.complete();
      await settle(t);
      expect(find.bySemanticsLabel('Loading the course…'), findsNothing);
      expect(find.text('Greet and introduce yourself'), findsWidgets);
      expect(containerOf(t).read(appStateProvider).activeCourse?.id, 'spanish-spain|en');
    });
  });
}
