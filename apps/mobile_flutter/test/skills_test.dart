// Reads the content bundle from disk (dart:io): VM only.
@TestOn('vm')
library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:langquest_mobile/core/backend/account.dart';
import 'package:langquest_mobile/core/backend/api_client.dart';
import 'package:langquest_mobile/core/backend/server_skills.dart';
import 'package:langquest_mobile/core/services/app_state.dart';
import 'package:langquest_mobile/main.dart';
import 'package:langquest_mobile/navigation/app_router.dart';

import 'support.dart';

Map<String, Object?> item(String key, String state, int evidence) => {
  'enrollmentId': 'enr-1',
  'skillKey': key,
  'masteryState': state,
  'internalScore': 0.5,
  'evidenceCount': evidence,
  'uncertainty': 0.4,
  'lastPracticedAt': '2026-11-10T08:00:00.000Z',
  'dueAt': null,
  'descriptor': key,
  'cefrCanDo': 'A1',
  'recentObservationTypes': <String>[],
};

/// The test learner's Spanish skills, as the live server returned them on 2026-11-11.
final liveSkills = [
  item('greet_politely', 'emerging', 1),
  item('introduce_self', 'practiced', 1),
  item('respond_to_greeting', 'independent', 3),
  item('speaking.intelligibility', 'independent', 6),
];

/// `GET /v1/me/skills`, one page per entry of [pages] (each but the last points to the next).
class FakeSkillsServer {
  FakeSkillsServer(this.pages, {this.failures = 0});

  final List<List<Map<String, Object?>>> pages;

  /// The first [failures] requests fail with a 503.
  int failures;
  final requests = <Uri>[];

  http.Client get client => MockClient((request) async {
    requests.add(request.url);
    if (request.url.path != '/v1/me/skills') return http.Response('{"ok":false}', 404);
    if (failures > 0) {
      failures--;
      return http.Response(
        jsonEncode({
          'ok': false,
          'error': {'code': 'unavailable', 'message': 'down'},
        }),
        503,
        headers: {'content-type': 'application/json'},
      );
    }
    final cursor = request.url.queryParameters['cursor'];
    final index = cursor == null ? 0 : int.parse(cursor);
    return http.Response(
      jsonEncode({
        'ok': true,
        'data': {'items': pages[index], 'nextCursor': index + 1 < pages.length ? '${index + 1}' : null, 'total': pages.expand((p) => p).length},
      }),
      200,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );
  });
}

/// Pump frames for [ms] (Progress has no endless animation, but async loads need frames).
Future<void> settle(WidgetTester t, [int ms = 600]) async {
  for (var i = 0; i < ms ~/ 100; i++) {
    await t.pump(const Duration(milliseconds: 100));
  }
}

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  group('server skills', () {
    test('parse: a known state and key; anything else is skipped', () {
      final s = ServerSkill.fromJson(item('respond_to_greeting', 'independent', 3))!;
      expect((s.key, s.mastery, s.evidence, s.step), ('respond_to_greeting', Mastery.independent, 3, 3));
      expect(s.lastPracticedAt, DateTime.utc(2026, 11, 10, 8));
      expect(ServerSkill.fromJson(item('greet_politely', 'fluent', 9)), isNull, reason: 'an unknown state is never guessed');
      expect(ServerSkill.fromJson({'masteryState': 'emerging'}), isNull);
    });

    test('what you can do: measured skills only, strongest first, then by evidence', () {
      final list = canDoList([
        for (final i in [...liveSkills, item('ask_name', 'not_attempted', 0)]) ServerSkill.fromJson(i)!,
      ]);
      expect([for (final s in list) s.key], ['speaking.intelligibility', 'respond_to_greeting', 'introduce_self', 'greet_politely']);
    });

    test('every skill the server tracks has an English and a French name in the bundle', () {
      expect(testBundle.skills, hasLength(greaterThanOrEqualTo(60)));
      for (final s in testBundle.skills.values) {
        expect(s.names['en'], isNotEmpty, reason: s.key);
        expect(s.names['fr'], isNotEmpty, reason: s.key);
      }
      expect(testBundle.skill('greet_politely')!.name('fr'), 'Saluer poliment');
      expect(testBundle.skill('speaking.intelligibility')!.system, isTrue);
      expect(testBundle.skill('unknown_skill'), isNull);
    });

    test('the API follows the cursor until every skill is read', () async {
      final server = FakeSkillsServer([liveSkills.sublist(0, 2), liveSkills.sublist(2)]);
      final api = LangQuestApi(baseUrl: 'https://api.test', accessToken: () async => 't', client: server.client);
      final items = await api.skills('enr-1');
      expect(items.map((i) => i['skillKey']), ['greet_politely', 'introduce_self', 'respond_to_greeting', 'speaking.intelligibility']);
      expect(server.requests.map((u) => u.queryParameters['enrollmentId']).toSet(), {'enr-1'});
      expect(server.requests.last.queryParameters['cursor'], '1');
    });
  });

  group('Progress: what you can do', () {
    Future<ProviderContainer> pump(
      WidgetTester t, {
      FakeSkillsServer? server,
      String? enrollmentId = 'enr-1',
      String device = 'en',
      String track = 'spanish-spain',
      double textScale = 1,
    }) async {
      t.view.physicalSize = const Size(390 * 3, 844 * 3);
      t.view.devicePixelRatio = 3;
      addTearDown(t.view.reset);
      if (textScale != 1) {
        t.platformDispatcher.textScaleFactorTestValue = textScale;
        addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
      }
      final api = server == null ? null : LangQuestApi(baseUrl: 'https://api.test', accessToken: () async => 't', client: server.client);
      await t.pumpWidget(
        ProviderScope(
          overrides: [
            ...await testOverrides(device: device),
            apiProvider.overrideWithValue(api),
            skillsEnrollmentProvider.overrideWithValue(enrollmentId),
          ],
          child: const LangQuestApp(),
        ),
      );
      final container = ProviderScope.containerOf(t.element(find.byType(LangQuestApp)));
      container.read(appStateProvider.notifier)
        ..setReduceMotion(true)
        ..enroll(track, device);
      container.read(appRouterProvider).go('/progress');
      await settle(t);
      return container;
    }

    testWidgets('lists the measured skills by name, strongest first, on the ladder, and explains the levels', (t) async {
      final semantics = t.ensureSemantics();
      final server = FakeSkillsServer([liveSkills]);
      await pump(t, server: server);
      expect(find.text('What you can do'), findsOneWidget);
      expect(find.text('Measured by LangQuest from your spoken answers, missions and live calls.'), findsOneWidget);
      expect(find.text('Start a mission to see your progress here.'), findsNothing, reason: 'the server measured something');
      final names = ['Be understood when speaking', 'Respond to a greeting', 'Introduce yourself', 'Greet someone politely'];
      for (final n in names) {
        expect(find.text(n), findsOneWidget);
      }
      final ys = [for (final n in names) t.getTopLeft(find.text(n)).dy];
      expect(ys, orderedEquals([...ys]..sort()), reason: 'strongest first');
      expect(find.text('Independent · 6 observations'), findsOneWidget);
      expect(find.text('Emerging · 1 observation'), findsOneWidget);
      expect(find.text('A1'), findsNWidgets(4));
      expect(find.bySemanticsLabel('Respond to a greeting: Independent, step 3 of 4, 3 observations'), findsOneWidget);
      expect(server.requests.single.queryParameters['enrollmentId'], 'enr-1');

      // How this is measured: the four levels and what they mean.
      expect(find.text('You did it on your own in conversation.', findRichText: true), findsNothing);
      await t.ensureVisible(find.text('How this is measured'));
      await t.tap(find.text('How this is measured'));
      await settle(t, 300);
      expect(find.textContaining('You did it on your own in conversation.', findRichText: true), findsOneWidget);
      expect(find.textContaining('You have done it on your own several times, over weeks.', findRichText: true), findsOneWidget);
      expect(find.textContaining('this is not a certificate'), findsOneWidget);
      await expectLater(t, meetsGuideline(labeledTapTargetGuideline));
      semantics.dispose();
    });

    testWidgets('in French: the skills\' French names and levels', (t) async {
      // Arabic (Moroccan) is taught from French.
      await pump(t, server: FakeSkillsServer([liveSkills]), device: 'fr', track: 'arabic-moroccan');
      expect(find.text('Ce que vous savez faire'), findsOneWidget);
      expect(find.text('Saluer poliment'), findsOneWidget);
      expect(find.text('Répondre à une salutation'), findsOneWidget);
      expect(find.text('Autonome · 3 observations'), findsOneWidget);
      expect(find.text('En émergence · 1 observation'), findsOneWidget);
    });

    testWidgets('signed out (no account course): no section at all, nothing requested', (t) async {
      final server = FakeSkillsServer([liveSkills]);
      await pump(t, server: server, enrollmentId: null);
      expect(find.text('What you can do'), findsNothing);
      expect(server.requests, isEmpty);
    });

    testWidgets('nothing measured yet: says how to get there', (t) async {
      await pump(t, server: FakeSkillsServer([[]]));
      expect(find.text('What you can do'), findsOneWidget);
      expect(find.text('Nothing measured yet. Answer out loud in a mission or call a character: what you can do appears here.'), findsOneWidget);
      expect(find.text('Start a mission to see your progress here.'), findsOneWidget);
      expect(find.text('How this is measured'), findsNothing);
    });

    testWidgets('a failed load says so and retries', (t) async {
      // Down for good (Riverpod retries a failed load on its own, so one failure alone would not show).
      final server = FakeSkillsServer([liveSkills], failures: 1000);
      await pump(t, server: server);
      expect(find.text('Couldn’t load what you can do.'), findsOneWidget);
      expect(find.text('Respond to a greeting'), findsNothing);
      server.failures = 0;
      await t.ensureVisible(find.text('Try again'));
      await t.tap(find.text('Try again'));
      await settle(t);
      expect(find.text('Respond to a greeting'), findsOneWidget);
      expect(find.text('Couldn’t load what you can do.'), findsNothing);
      // Leave no retry timer behind.
      await t.pumpWidget(const SizedBox());
      await settle(t, 7000);
    });

    testWidgets('holds up at 200% text on a small phone', (t) async {
      await pump(t, server: FakeSkillsServer([liveSkills]), textScale: 2);
      t.view.physicalSize = const Size(360 * 3, 690 * 3);
      await settle(t);
      await t.scrollUntilVisible(find.text('Greet someone politely'), 200, scrollable: find.byType(Scrollable).first);
      expect(t.takeException(), isNull);
    });
  });
}
