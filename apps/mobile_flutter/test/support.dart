import 'dart:io';

import 'package:flutter/services.dart' show AssetBundle, ByteData, CachingAssetBundle;
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:langquest_mobile/core/content/content_bundle.dart';
import 'package:langquest_mobile/core/services/app_state.dart';
import 'package:langquest_mobile/core/services/learner_store.dart';
import 'package:langquest_mobile/main.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Every course's chapters file of the package's assets (`assets/content/chapters/<track>.json`), by file name.
List<File> courseChapterFiles() =>
    Directory('assets/content/chapters').listSync().whereType<File>().where((f) => f.path.endsWith('.json')).toList()..sort((a, b) => a.path.compareTo(b.path));

/// The real bundle, read from the package's assets (tests run from the package root), with every course's chapters.
final ContentBundle testBundle = ContentBundle.parse(
  catalogJson: File('assets/content/catalog.json').readAsStringSync(),
  chapterFiles: [for (final f in courseChapterFiles()) f.readAsStringSync()],
  skillsJson: File('assets/content/skills.json').readAsStringSync(),
  castJson: File('assets/content/cast.json').readAsStringSync(),
  examplesJson: File('assets/content/examples.json').readAsStringSync(),
  voicesJson: File('assets/content/voices.json').readAsStringSync(),
);

/// Fixed local clock for schedules, streaks and XP days.
final DateTime testNow = DateTime(2026, 11, 10, 9);

/// A mutable clock tests can move forward.
class TestClock {
  DateTime now;
  TestClock([DateTime? start]) : now = start ?? testNow;
  DateTime call() => now;
  void advance(Duration d) => now = now.add(d);
}

/// The app's assets read from the package directory, counting each file read (courses' chapters load on demand).
class DiskAssets extends CachingAssetBundle {
  final reads = <String>[];

  @override
  Future<ByteData> load(String key) async {
    reads.add(key);
    final file = File(key);
    if (!file.existsSync()) throw FlutterError('Unable to load asset: "$key".');
    return ByteData.sublistView(file.readAsBytesSync());
  }
}

/// [content] is the bundle the app starts with (every course's chapters by default); [assets] where it reads the
/// courses it loads later.
Future<List<Override>> testOverrides({
  Map<String, Object> prefs = const {},
  TestClock? clock,
  String device = 'en',
  ContentBundle? content,
  AssetBundle? assets,
}) async {
  SharedPreferences.setMockInitialValues(prefs);
  final sp = await SharedPreferences.getInstance();
  final c = clock ?? TestClock();
  return [
    initialContentProvider.overrideWithValue(content ?? testBundle),
    if (assets != null) assetBundleProvider.overrideWithValue(assets),
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
  AssetBundle? assets,
}) async {
  final container = ProviderContainer(
    overrides: await testOverrides(prefs: prefs, clock: clock, device: device, content: content, assets: assets),
  );
  return container;
}

Future<Widget> testApp({Map<String, Object> prefs = const {}, TestClock? clock, String device = 'en'}) async => ProviderScope(
  overrides: await testOverrides(prefs: prefs, clock: clock, device: device),
  child: const LangQuestApp(),
);
