import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:langquest_mobile/core/content/content_bundle.dart';
import 'package:langquest_mobile/core/services/app_state.dart';
import 'package:langquest_mobile/core/services/learner_store.dart';
import 'package:langquest_mobile/main.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The real bundle, read from the package's assets (tests run from the package root).
final ContentBundle testBundle = ContentBundle.parse(
  catalogJson: File('assets/content/catalog.json').readAsStringSync(),
  chaptersJson: File('assets/content/chapters.json').readAsStringSync(),
  skillsJson: File('assets/content/skills.json').readAsStringSync(),
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

Future<List<Override>> testOverrides({Map<String, Object> prefs = const {}, TestClock? clock, String device = 'en'}) async {
  SharedPreferences.setMockInitialValues(prefs);
  final sp = await SharedPreferences.getInstance();
  final c = clock ?? TestClock();
  return [
    contentBundleProvider.overrideWithValue(testBundle),
    learnerStoreProvider.overrideWithValue(LearnerStore(sp)),
    clockProvider.overrideWithValue(c.call),
    deviceLanguageProvider.overrideWithValue(device),
  ];
}

Future<ProviderContainer> testContainer({Map<String, Object> prefs = const {}, TestClock? clock, String device = 'en'}) async {
  final container = ProviderContainer(
    overrides: await testOverrides(prefs: prefs, clock: clock, device: device),
  );
  return container;
}

Future<Widget> testApp({Map<String, Object> prefs = const {}, TestClock? clock, String device = 'en'}) async => ProviderScope(
  overrides: await testOverrides(prefs: prefs, clock: clock, device: device),
  child: const LangQuestApp(),
);
