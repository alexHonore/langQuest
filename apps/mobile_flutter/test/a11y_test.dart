// Reads the content bundle from disk (dart:io): VM only.
@TestOn('vm')
library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:langquest_mobile/core/services/app_state.dart';
import 'package:langquest_mobile/core/services/learner_state.dart';
import 'package:langquest_mobile/core/services/learner_store.dart';
import 'package:langquest_mobile/features/learn/learn_logic.dart';
import 'package:langquest_mobile/main.dart';
import 'package:langquest_mobile/navigation/app_router.dart';

import 'support.dart';

/// Flutter's own accessibility guidelines on every main screen: whatever can be tapped has a name a screen reader can
/// say, and is big enough for a finger (48 × 48 on Android).
void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  testWidgets('every screen: tap targets are labelled and big enough', (t) async {
    final semantics = t.ensureSemantics();
    t.view.physicalSize = const Size(390 * 3, 844 * 3);
    t.view.devicePixelRatio = 3;
    addTearDown(t.view.reset);
    await t.pumpWidget(await testApp(prefs: {LearnerStore.key: jsonEncode(const LearnerState(reduceMotion: true).toJson())}));
    final container = ProviderScope.containerOf(t.element(find.byType(LangQuestApp)));
    Future<void> check(String route) async {
      container.read(appRouterProvider).go(route);
      await t.pumpAndSettle();
      await expectLater(t, meetsGuideline(labeledTapTargetGuideline), reason: route);
      await expectLater(t, meetsGuideline(androidTapTargetGuideline), reason: route);
    }

    await check('/welcome');
    await check('/welcome/courses');
    final notifier = container.read(appStateProvider.notifier)..enroll('spanish-spain', 'en');
    notifier.completeStop('es_greet_and_introduce', PathStop.learn);
    for (final route in [
      '/warmup',
      '/',
      '/missions',
      '/progress',
      '/account',
      '/catalog',
      '/course/japanese',
      '/path/es_greet_and_introduce',
      '/learn/es_greet_and_introduce/scene',
      '/learn/es_greet_and_introduce/cards',
      '/learn/es_greet_and_introduce/practice',
      '/mission/es_greet_and_introduce',
      '/call/es_greet_and_introduce',
      '/review',
    ]) {
      await check(route);
    }
    semantics.dispose();
  });
}
