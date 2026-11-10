// Reads the content bundle from disk (dart:io): VM only. Pure logic shared with web is covered by srs_test.dart.
@TestOn('vm')
library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:langquest_mobile/core/learning/srs.dart';
import 'package:langquest_mobile/core/services/app_state.dart';
import 'package:langquest_mobile/core/services/learner_state.dart';
import 'package:langquest_mobile/core/services/learner_store.dart';
import 'package:langquest_mobile/features/learn/learn_content.dart';
import 'package:langquest_mobile/features/learn/learn_logic.dart';
import 'package:langquest_mobile/main.dart';
import 'package:langquest_mobile/navigation/app_router.dart';

import 'support.dart';

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

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  test('first-run redirect rules', () {
    expect(redirectFor('/', hasEnrollment: false), '/welcome');
    expect(redirectFor('/missions', hasEnrollment: false), '/welcome');
    expect(redirectFor('/course/japanese', hasEnrollment: false), isNull);
    expect(redirectFor('/catalog', hasEnrollment: false), isNull);
    expect(redirectFor('/welcome/courses', hasEnrollment: true), '/');
    expect(redirectFor('/review', hasEnrollment: true), isNull);
  });

  testWidgets('first run: welcome → courses ready in English → disclosure → enrolled Home', (t) async {
    usePhone(t);
    await t.pumpWidget(await testApp());
    await settle(t);
    expect(find.text('Learn a language by using it'), findsOneWidget);

    await tapText(t, 'Choose a course');
    expect(find.text('What do you want to learn?'), findsOneWidget);
    expect(find.text('Arabic (Moroccan)'), findsOneWidget);
    expect(find.text('Spanish (Spain-Castilian)'), findsOneWidget);
    expect(find.text('Japanese'), findsOneWidget);
    expect(find.text('English'), findsNothing, reason: 'English is taught from French and Russian only');

    await tapText(t, 'Spanish (Spain-Castilian)');
    expect(find.text('What this course includes'), findsOneWidget);
    expect(find.text('Mission pathway (6 missions)'), findsOneWidget);
    await t.scrollUntilVisible(find.text('Live conversation with AI characters'), 200, scrollable: find.byType(Scrollable).first);
    expect(find.textContaining('Native-speaker review'), findsOneWidget);

    await tapText(t, 'Start this course');
    expect(containerOf(t).read(appStateProvider).activeCourse?.id, 'spanish-spain|en');
    expect(find.text('Greet and introduce yourself'), findsWidgets);
    expect(find.text('Start: Learn'), findsOneWidget);
    // Only tabs backed by something real: no Audio, no Speak.
    expect(find.text('Home'), findsOneWidget);
    expect(find.text('Missions'), findsOneWidget);
    expect(find.text('Progress'), findsOneWidget);
    expect(find.text('Audio'), findsNothing);
    expect(find.text('Speak'), findsNothing);
  });

  for (final textScale in [1.0, 2.0]) {
    testWidgets('a whole mission node: scene → cards → pairs → tiles → mission → review queue and XP (text ×$textScale)', (t) async {
      usePhone(t);
      // Also at the largest text size a device can ask for (Android's 200%): every step still fits or scrolls.
      t.platformDispatcher.textScaleFactorTestValue = textScale;
      addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
      final clock = TestClock();
      await t.pumpWidget(await testApp(clock: clock));
      await settle(t);
      final container = containerOf(t);
      container.read(appStateProvider.notifier).enroll('spanish-spain', 'en');
      await settle(t);

      final mission = testBundle.mission('es_greet_and_introduce')!;
      final plan = buildLearnPlan(mission: mission, track: testBundle.track('spanish-spain')!, source: 'en', character: testBundle.characterOf(mission));

      await tapText(t, 'Start: Learn'); // Home card
      expect(find.text('Lucía'), findsWidgets, reason: 'the mission character is on the path');
      await tapText(t, 'Start: Learn'); // path primary action

      // L1 scene: every line is shown with its meaning; the learner shadows their own lines.
      for (final line in plan.sceneLines) {
        expect(find.text(line.expression.text), findsOneWidget);
        expect(find.text(plan.meaningOf(line.expression)), findsOneWidget);
        await tapText(t, line.byLearner ? 'I said it' : (line == plan.sceneLines.last ? 'Learn the phrases' : 'Next'));
      }

      // L3 cards.
      for (var i = 0; i < plan.phrases.length; i++) {
        expect(find.text(plan.phrases[i].text), findsOneWidget);
        await tapText(t, i == plan.phrases.length - 1 ? 'Practise' : 'Next phrase');
      }
      expect(container.read(appStateProvider).stopsDone(mission.key), {PathStop.learn});

      // Pairs, round by round.
      for (var r = 0; r < plan.pairRounds.length; r++) {
        for (final e in plan.pairRounds[r]) {
          await tapText(t, e.text);
          await tapText(t, plan.shortMeaningOf(e));
        }
        expect(find.text('All matched!'), findsOneWidget);
        await tapText(t, r < plan.pairRounds.length - 1 ? 'Next round' : 'Build a sentence');
      }

      // Tiles: a wrong order is refused, the right one accepted.
      final tiles = plan.tiles!;
      Finder bankTile(String w) => find.descendant(of: find.byType(Wrap).last, matching: find.text(w)).first;
      for (final w in tiles.answer.reversed) {
        await t.tap(bankTile(w));
        await settle(t, 300);
      }
      await tapText(t, 'Check');
      expect(find.text('Not quite — tap a word to take it back.'), findsOneWidget);
      for (final w in tiles.answer.reversed) {
        await t.tap(find.descendant(of: find.byType(Wrap).first, matching: find.text(w)).first);
        await settle(t, 300);
      }
      for (final w in tiles.answer) {
        await t.tap(bankTile(w));
        await settle(t, 300);
      }
      await tapText(t, 'Check');
      await tapText(t, 'Start the mission');
      expect(container.read(appStateProvider).stopsDone(mission.key), {PathStop.learn, PathStop.practise});

      // Mission: pick a wrong option once on the first exchange, then the right ones; say each out loud.
      for (final (i, x) in plan.exchanges.indexed) {
        if (i == 0) {
          final wrong = x.options.firstWhere((o) => o != x.answer);
          await tapText(t, wrong.text);
          expect(find.text('Not quite — think of what you practised.'), findsOneWidget);
        }
        await tapText(t, x.answer.text);
        expect(find.text('Say it out loud'), findsOneWidget);
        await tapText(t, 'I said it');
      }
      expect(find.text('What you used'), findsOneWidget);
      await tapText(t, 'Complete the mission (+50 XP)');
      expect(find.text('Mission completed!'), findsOneWidget);
      expect(find.text('+50 XP'), findsOneWidget);

      final s = container.read(appStateProvider);
      expect(s.progress.isMissionCompleted(mission.key), isTrue);
      expect(s.learner.xpTotal, 2 * XpAmounts.stepCompleted + XpAmounts.missionCompleted);
      expect(s.progress.cards.length, plan.exchanges.length);
      expect(
        s.progress.cards[plan.exchanges.first.answer.id]!.difficulty,
        greaterThan(s.progress.cards[plan.exchanges.last.answer.id]!.difficulty),
        reason: 'the exchange answered wrong first was rated hard',
      );

      // Next mission is now open.
      await tapText(t, 'Next mission');
      expect(find.text('Ordering at the bar'), findsWidgets);
    });
  }

  testWidgets('a locked mission says what to finish first', (t) async {
    usePhone(t);
    await t.pumpWidget(await testApp());
    await settle(t);
    containerOf(t).read(appStateProvider.notifier).enroll('japanese', 'en');
    await settle(t);
    await tapText(t, 'Missions');
    expect(find.textContaining('AI-drafted chapter'), findsOneWidget);
    await tapText(t, 'Ordering at a café');
    expect(find.text('Finish “Greet and introduce yourself” first'), findsOneWidget);
    expect(find.text('Start: Learn'), findsNothing, reason: 'the locked node did not open');
  });

  testWidgets('French interface, Darija from French: right-to-left script with Arabizi, no voice controls', (t) async {
    usePhone(t);
    await t.pumpWidget(await testApp(device: 'fr'));
    await settle(t);
    expect(find.text('Apprenez une langue en la pratiquant'), findsOneWidget);
    await tapText(t, 'Choisir un cours');
    expect(find.text('Arabe (marocain)'), findsOneWidget);
    expect(find.text('Anglais'), findsOneWidget);
    await tapText(t, 'Arabe (marocain)');
    await t.scrollUntilVisible(find.textContaining('Une voix pour ce dialecte'), 200, scrollable: find.byType(Scrollable).first);
    await tapText(t, 'Commencer ce cours');
    expect(find.text('Commencer : Apprendre'), findsOneWidget);
    await tapText(t, 'Commencer : Apprendre');
    await tapText(t, 'Commencer : Apprendre');

    final salam = find.text('السلام عليكم');
    expect(salam, findsOneWidget);
    expect(t.widget<Text>(salam).textDirection, TextDirection.rtl);
    expect(find.text('salam 3likom'), findsOneWidget);
    expect(find.text('Bonjour (litt. « que la paix soit sur vous »).'), findsOneWidget);
    expect(find.text('Écouter'), findsNothing, reason: 'no device voice may speak Darija');
    expect(find.text('Voix de synthèse'), findsNothing);
  });

  testWidgets('review screen flow on a due card (light theme)', (t) async {
    usePhone(t);
    final clock = TestClock();
    await t.pumpWidget(await testApp(clock: clock));
    await settle(t);
    final container = containerOf(t);
    const id = 'es_es_ch1_arrival_madrid:es_cafe_order_drink:cafe_con_leche';
    container.read(appStateProvider.notifier)
      ..enroll('spanish-spain', 'en')
      ..completeMission('es_cafe_order_drink', {id: ReviewRating.good})
      ..setDarkMode(false);
    clock.advance(const Duration(minutes: 11));
    await settle(t);
    // Home rebuilds on the next state change; re-read the clock by toggling nothing but pumping a route change.
    container.read(appRouterProvider).go('/progress');
    await settle(t);
    container.read(appRouterProvider).go('/');
    await settle(t);
    expect(find.text('1 review due'), findsOneWidget);

    await tapText(t, 'Review');
    expect(find.text('A coffee with milk, please'), findsOneWidget);
    expect(find.text('Un café con leche, por favor.'), findsNothing, reason: 'the answer is hidden until revealed');
    await tapText(t, 'Show answer');
    expect(find.text('Un café con leche, por favor.'), findsOneWidget);
    await tapText(t, 'Good');
    expect(find.text('All caught up for today.'), findsOneWidget);
    final card = container.read(appStateProvider).progress.cards[id]!;
    expect(card.state, CardState.review);
    expect(card.due.isAfter(clock.now.add(const Duration(days: 1))), isTrue);
  });

  testWidgets('every tab and settings render in dark and light without layout errors', (t) async {
    usePhone(t, width: 360, height: 690);
    await t.pumpWidget(await testApp());
    await settle(t);
    final container = containerOf(t);
    container.read(appStateProvider.notifier).enroll('japanese', 'en');
    await settle(t);
    for (final dark in [true, false]) {
      container.read(appStateProvider.notifier).setDarkMode(dark);
      for (final route in ['/', '/missions', '/progress', '/account', '/catalog', '/course/arabic-moroccan', '/course/french', '/path/ja_cafe_order_drink']) {
        container.read(appRouterProvider).go(route);
        await settle(t, 400);
        expect(t.takeException(), isNull, reason: '$route dark=$dark');
      }
    }
    expect(find.text('Not available yet. Planned.'), findsNothing); // last route is a path
  });

  testWidgets('every screen holds up at the largest text size (200%) on a small phone', (t) async {
    usePhone(t, width: 360, height: 690);
    t.platformDispatcher.textScaleFactorTestValue = 2;
    addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
    await t.pumpWidget(await testApp(prefs: {LearnerStore.key: jsonEncode(const LearnerState(reduceMotion: true).toJson())}));
    final container = containerOf(t);
    Future<void> visit(String route) async {
      container.read(appRouterProvider).go(route);
      await t.pumpAndSettle();
      expect(t.takeException(), isNull, reason: route);
    }

    await visit('/welcome');
    await visit('/welcome/courses');
    container.read(appStateProvider.notifier).enroll('japanese', 'en');
    for (final route in [
      '/',
      '/missions',
      '/progress',
      '/account',
      '/catalog',
      '/course/arabic-moroccan',
      '/path/ja_greet_and_introduce',
      '/learn/ja_greet_and_introduce/scene',
      '/learn/ja_greet_and_introduce/cards',
      '/learn/ja_greet_and_introduce/practice',
      '/mission/ja_greet_and_introduce',
      '/review',
    ]) {
      await visit(route);
    }
  });

  testWidgets('a stale link to a mission outside the course shows a way back, not a crash', (t) async {
    usePhone(t);
    await t.pumpWidget(await testApp());
    await settle(t);
    final container = containerOf(t);
    container.read(appStateProvider.notifier).enroll('japanese', 'en');
    await settle(t);
    container.read(appRouterProvider).go('/learn/ary_cafe_order_drink/scene');
    await settle(t);
    expect(find.text('This mission is not part of your current course.'), findsOneWidget);
    await tapText(t, 'Back home');
    expect(GoRouter.of(t.element(find.byType(Scaffold).first)).state.matchedLocation, '/');
  });
}
