// Reads the content bundle from disk (dart:io): VM only.
@TestOn('vm')
library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:langquest_mobile/core/services/app_state.dart';
import 'package:langquest_mobile/core/services/learner_state.dart';
import 'package:langquest_mobile/core/services/learner_store.dart';
import 'package:langquest_mobile/features/account/display_settings.dart';
import 'package:langquest_mobile/features/mascot/melo_painter.dart';
import 'package:langquest_mobile/features/mascot/melo_widget.dart';
import 'package:langquest_mobile/features/onboarding/welcome_screen.dart';
import 'package:langquest_mobile/l10n/l10n.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support.dart';

Map<String, Object> stored(LearnerState learner) => {LearnerStore.key: jsonEncode(learner.toJson())};

/// The learner state as the app holds it.
LearnerState learnerOf(WidgetTester tester) => ProviderScope.containerOf(tester.element(find.byType(MaterialApp).first)).read(appStateProvider).learner;

void main() {
  test('display choices are saved, and older saved states get the defaults', () {
    const learner = LearnerState(darkMode: false, followDeviceTheme: true, textScale: 1.3, reduceMotion: true, mascot: false);
    final back = LearnerState.fromJson(jsonDecode(jsonEncode(learner.toJson())));
    expect([back.darkMode, back.followDeviceTheme, back.textScale, back.reduceMotion, back.mascot], [false, true, 1.3, true, false]);

    final older = LearnerState.fromJson({'v': LearnerState.schemaVersion, 'darkMode': true});
    expect([older.followDeviceTheme, older.textScale, older.reduceMotion, older.mascot], [false, 1.0, false, true]);
    expect(nearestTextScale(1.2), 1.15, reason: 'a stored size this version does not offer becomes the closest one');
    expect(nearestTextScale(4), 1.8);
  });

  test('resetting progress keeps the display choices', () async {
    final container = await testContainer(prefs: stored(const LearnerState(textScale: 1.5, reduceMotion: true, mascot: false, followDeviceTheme: true)));
    addTearDown(container.dispose);
    container.read(appStateProvider.notifier).resetAll();
    final learner = container.read(appStateProvider).learner;
    expect([learner.textScale, learner.reduceMotion, learner.mascot, learner.followDeviceTheme], [1.5, true, false, true]);
  });

  testWidgets('the text size multiplies the device\'s own, everywhere in the app', (tester) async {
    tester.platformDispatcher.textScaleFactorTestValue = 1.2;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await tester.pumpWidget(await testApp(prefs: stored(const LearnerState(textScale: 1.5, reduceMotion: true))));
    await tester.pumpAndSettle();
    final context = tester.element(find.byType(WelcomeScreen));
    expect(MediaQuery.textScalerOf(context).scale(10), closeTo(18, 0.001));
  });

  testWidgets('reduced motion stills Melo and the screens (nothing left animating)', (tester) async {
    await tester.pumpWidget(await testApp(prefs: stored(const LearnerState(reduceMotion: true))));
    await tester.pumpAndSettle(); // would time out while Melo breathes
    expect(find.byType(MeloWidget), findsOneWidget);
    expect(MediaQuery.disableAnimationsOf(tester.element(find.byType(WelcomeScreen))), isTrue);
    expect(tester.binding.hasScheduledFrame, isFalse);
  });

  testWidgets('without reduced motion Melo keeps moving', (tester) async {
    await tester.pumpWidget(await testApp());
    await tester.pump(const Duration(seconds: 1));
    expect(tester.binding.hasScheduledFrame, isTrue);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('the mascot can be hidden', (tester) async {
    await tester.pumpWidget(await testApp(prefs: stored(const LearnerState(mascot: false, reduceMotion: true))));
    await tester.pumpAndSettle();
    expect(find.byType(MeloWidget), findsOneWidget);
    expect(find.byWidgetPredicate((w) => w is CustomPaint && w.painter is MeloPainter), findsNothing);
  });

  testWidgets('following the device\'s theme mirrors it when it changes', (tester) async {
    tester.platformDispatcher.platformBrightnessTestValue = Brightness.light;
    addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
    await tester.pumpWidget(await testApp(prefs: stored(const LearnerState(darkMode: true, followDeviceTheme: true, reduceMotion: true))));
    await tester.pumpAndSettle();
    expect(learnerOf(tester).darkMode, isFalse);

    tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
    await tester.pumpAndSettle();
    expect(learnerOf(tester).darkMode, isTrue);
  });

  testWidgets('Settings › Display changes and saves each choice', (tester) async {
    tester.platformDispatcher.platformBrightnessTestValue = Brightness.light;
    addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
    await tester.pumpWidget(
      ProviderScope(
        overrides: await testOverrides(prefs: stored(const LearnerState(reduceMotion: true))),
        child: const MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(body: SingleChildScrollView(child: DisplaySettings())),
        ),
      ),
    );
    await tester.pump();
    LearnerState learner() => learnerOf(tester);

    await tester.tap(find.text('Light'));
    await tester.pump();
    expect([learner().darkMode, learner().followDeviceTheme], [false, false]);

    await tester.tap(find.text('Device'));
    await tester.pump();
    expect([learner().followDeviceTheme, learner().darkMode], [true, false], reason: 'starts from the device\'s current setting (light)');

    await tester.tap(find.text('Dark'));
    await tester.pump();
    expect([learner().darkMode, learner().followDeviceTheme], [true, false]);

    expect(find.text('100%'), findsOneWidget);
    await tester.tap(find.byTooltip('Larger text'));
    await tester.pump();
    await tester.tap(find.byTooltip('Larger text'));
    await tester.pump();
    expect(learner().textScale, 1.3);
    expect(find.text('130%'), findsOneWidget);
    expect(find.bySemanticsLabel('Text size 130%'), findsOneWidget);
    for (var i = 0; i < 6; i++) {
      await tester.tap(find.byTooltip('Smaller text'));
      await tester.pump();
    }
    expect(learner().textScale, 0.9, reason: 'the smallest size stops the steps');
    expect(tester.widget<IconButton>(find.widgetWithIcon(IconButton, LucideIcons.minus)).onPressed, isNull);
    await tester.tap(find.byTooltip('Larger text'));
    await tester.pump();
    await tester.tap(find.byTooltip('Larger text'));
    await tester.pump();
    await tester.tap(find.byTooltip('Larger text'));
    await tester.pump();
    expect(learner().textScale, 1.3);

    await tester.tap(find.text('Reduce motion'));
    await tester.pump();
    expect(learner().reduceMotion, isFalse);

    await tester.tap(find.text('Show Melo, the mascot'));
    await tester.pump();
    expect(learner().mascot, isFalse);

    final saved = LearnerState.fromJson(jsonDecode((await SharedPreferences.getInstance()).getString(LearnerStore.key)!));
    expect([saved.textScale, saved.mascot, saved.reduceMotion], [1.3, false, false]);
  });
}
