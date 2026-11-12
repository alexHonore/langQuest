import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:langquest_mobile/core/content/content_bundle.dart';
import 'package:langquest_mobile/core/services/app_state.dart';
import 'package:langquest_mobile/core/services/learner_store.dart';
import 'package:langquest_mobile/main.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Reads a bundle file from the package's assets (tests run from the package root), as the app's asset bundle would.
Future<String> readTestAsset(String path) async => File(path).readAsStringSync();

/// The course chapter files of the bundle (`assets/content/chapters/<trackId>.json`), in file-name order.
final List<File> courseFiles = Directory('assets/content/chapters').listSync().whereType<File>().where((f) => f.path.endsWith('.json')).toList()
  ..sort((a, b) => a.path.compareTo(b.path));

/// The real bundle with every course loaded, read from the package's assets.
final ContentBundle testBundle = ContentBundle.parse(
  catalogJson: File(ContentBundle.catalogAsset).readAsStringSync(),
  coursesJson: [for (final f in courseFiles) f.readAsStringSync()],
  skillsJson: File(ContentBundle.skillsAsset).readAsStringSync(),
  castJson: File(ContentBundle.castAsset).readAsStringSync(),
  examplesJson: File(ContentBundle.examplesAsset).readAsStringSync(),
  voicesJson: File(ContentBundle.voicesAsset).readAsStringSync(),
);

/// The bundle as the app starts with it: the catalog and what every course shares, plus only the chapters of [courses].
Future<ContentBundle> startupBundle({Iterable<String> courses = const []}) => ContentBundle.load(readTestAsset, courses: courses);

/// Fixed local clock for schedules, streaks and XP days.
final DateTime testNow = DateTime(2026, 11, 10, 9);

/// A mutable clock tests can move forward.
class TestClock {
  DateTime now;
  TestClock([DateTime? start]) : now = start ?? testNow;
  DateTime call() => now;
  void advance(Duration d) => now = now.add(d);
}

/// [content]: the bundle the app starts with (every course loaded by default); other courses are read with [read]
/// (the package's assets by default).
Future<List<Override>> testOverrides({
  Map<String, Object> prefs = const {},
  TestClock? clock,
  String device = 'en',
  ContentBundle? content,
  ContentReader read = readTestAsset,
}) async {
  SharedPreferences.setMockInitialValues(prefs);
  final sp = await SharedPreferences.getInstance();
  final c = clock ?? TestClock();
  return [
    contentBundleProvider.overrideWith(() => ContentNotifier(content ?? testBundle, read: read)),
    learnerStoreProvider.overrideWithValue(LearnerStore(sp)),
    clockProvider.overrideWithValue(c.call),
    deviceLanguageProvider.overrideWithValue(device),
  ];
}

Future<ProviderContainer> testContainer({
  Map<String, Object> prefs = const {},
  TestClock? clock,
  String device = 'en',
  ContentBundle? content,
  ContentReader read = readTestAsset,
}) async {
  final container = ProviderContainer(
    overrides: await testOverrides(prefs: prefs, clock: clock, device: device, content: content, read: read),
  );
  return container;
}

Future<Widget> testApp({
  Map<String, Object> prefs = const {},
  TestClock? clock,
  String device = 'en',
  ContentBundle? content,
  ContentReader read = readTestAsset,
}) async => ProviderScope(
  overrides: await testOverrides(prefs: prefs, clock: clock, device: device, content: content, read: read),
  child: const LangQuestApp(),
);
