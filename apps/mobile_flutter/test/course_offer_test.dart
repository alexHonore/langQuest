// Reads the content bundle from disk (dart:io): VM only.
@TestOn('vm')
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:langquest_mobile/core/backend/account.dart';
import 'package:langquest_mobile/core/backend/server_course.dart';
import 'package:langquest_mobile/main.dart';
import 'package:langquest_mobile/navigation/app_router.dart';

import 'support.dart';

/// The course page lists what an account adds only when the server offers it for the course.
void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  Future<void> pump(WidgetTester t, Map<String, ServerTrackOffer> offers) async {
    t.view.physicalSize = const Size(390 * 3, 1400 * 3);
    t.view.devicePixelRatio = 3;
    addTearDown(t.view.reset);
    await t.pumpWidget(
      ProviderScope(overrides: [...await testOverrides(), serverOffersProvider.overrideWith((ref, source) async => offers)], child: const LangQuestApp()),
    );
    ProviderScope.containerOf(t.element(find.byType(LangQuestApp))).read(appRouterProvider).go('/course/arabic-moroccan');
    for (var i = 0; i < 10; i++) {
      await t.pump(const Duration(milliseconds: 100));
    }
  }

  testWidgets('with the server\'s offer: live calls and checked answers are included, the dialect caveat is said', (t) async {
    await pump(t, {'arabic-moroccan': const ServerTrackOffer(characters: 4, liveCalls: true, spokenCheck: true, aiVoice: true)});
    expect(find.text('Live calls with 4 AI characters, by voice or in writing (with a free account)'), findsOneWidget);
    expect(find.text('Your spoken answers checked: LangQuest tells you whether you were understood (with a free account)'), findsOneWidget);
    expect(find.text('Speech recognition and AI voices are still limited for this dialect (not yet reviewed by native speakers)'), findsOneWidget);
    expect(find.text('A pronunciation score: spoken answers are checked for meaning, not accent'), findsOneWidget);
    expect(find.text('Live conversation with AI characters'), findsNothing);
    expect(find.text('Spoken pronunciation feedback'), findsNothing);
  });

  testWidgets('offline (no offer): nothing an account would add is promised', (t) async {
    await pump(t, const {});
    expect(find.textContaining('Live calls'), findsNothing);
    expect(find.text('Live conversation with AI characters'), findsOneWidget);
    expect(find.text('Spoken pronunciation feedback'), findsOneWidget);
    expect(find.textContaining('still limited for this dialect'), findsNothing);
  });
}
