// Reads the content bundle from disk (dart:io): VM only.
@TestOn('vm')
library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:langquest_mobile/core/audio/clip_player_provider.dart';
import 'package:langquest_mobile/core/backend/account.dart';
import 'package:langquest_mobile/core/backend/api_client.dart';
import 'package:langquest_mobile/core/backend/server_course.dart';
import 'package:langquest_mobile/core/services/app_state.dart';
import 'package:langquest_mobile/core/services/learner_store.dart';
import 'package:langquest_mobile/core/services/speaking_stats.dart';
import 'package:langquest_mobile/features/audio/audio_screens.dart';
import 'package:langquest_mobile/features/call/call_history.dart';
import 'package:langquest_mobile/features/call/call_screen.dart';
import 'package:langquest_mobile/features/call/call_session.dart';
import 'package:langquest_mobile/features/learn/record_take.dart';
import 'package:langquest_mobile/main.dart';
import 'package:langquest_mobile/navigation/app_router.dart';

import 'call_fakes.dart';
import 'recording_fakes.dart';
import 'support.dart';

const missionKey = 'es_greet_and_introduce';
const course = ServerCourse(enrollmentId: 'enr-1', targetVarietyId: 'es-ES', speechCheck: true, liveConversation: true, voiceConversation: true);
const courseId = 'spanish-spain|en';

Future<void> settle(WidgetTester t, [int ms = 900]) async {
  for (var i = 0; i < ms ~/ 100; i++) {
    await t.pump(const Duration(milliseconds: 100));
  }
}

Future<void> tapLabel(WidgetTester t, String label, {int ms = 900}) async {
  final f = find.bySemanticsLabel(label);
  expect(f, findsWidgets, reason: 'nothing labelled "$label"');
  await t.ensureVisible(f.first);
  await t.tap(f.first);
  await settle(t, ms);
}

CallRecord record(String id, DateTime at, {String course = courseId}) =>
    CallRecord(id: id, courseId: course, at: at, seconds: 75, characterName: 'Pablo', characterRole: 'Schoolboy', characterId: pabloId);

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  group('the record of a call', () {
    test('made from the ended session: goals by the server\'s count, corrections, summary, the transcript', () async {
      final server = FakeConversationServer(
        turns: [
          const ScriptedTurn(heard: 'Hola, yo llamo Alex', reply: '¡Encantado, Alex!', objectives: ['greet']),
        ],
      );
      var ids = 0;
      final call = CallSession(
        api: LangQuestApi(baseUrl: 'https://api.test', accessToken: () async => 't', client: server.client),
        course: course,
        missionId: '4e4a1d03-3dd3-5585-82c9-7c148a551e9e',
        voice: false,
        newId: () => '00000000-0000-4000-8000-${(++ids).toString().padLeft(12, '0')}',
      );
      await call.start();
      await call.sendText('Hola, yo llamo Alex');
      await call.hangUp();
      final r = CallRecord.fromSession(
        call,
        courseId: courseId,
        at: DateTime.utc(2026, 11, 11, 9, 12),
        seconds: 192,
        missionKey: missionKey,
        title: 'Greet and introduce yourself',
      );
      expect(r.id, '11111111-1111-4111-8111-111111111111', reason: 'the server\'s session id');
      expect((r.characterName, r.characterRole, r.characterId), ('Pablo', 'Schoolboy', pabloId));
      expect((r.goalCount, r.goalsMet), (2, 1));
      expect(r.goalsDone, ['Greet Pablo']);
      expect(r.goalsOpen, ['Say your name']);
      expect(r.summary, 'You greeted Pablo and said your name.');
      expect((r.corrections.single.said, r.corrections.single.better), ('Yo llamo Alex', 'Me llamo Alex.'));
      expect((r.xp, r.evaluated), (30, true));
      expect(
        [for (final l in r.lines) (l.fromLearner, l.text)],
        [(false, '¡Hola! Soy Pablo. ¿Cómo te llamas?'), (true, 'Hola, yo llamo Alex'), (false, '¡Encantado, Alex!')],
      );
      expect(r.lines.first.gloss, 'Hi! I’m Pablo. What’s your name?');

      // Kept as JSON, read back the same.
      final back = CallRecord.fromJson(jsonDecode(jsonEncode(r.toJson())))!;
      expect(jsonEncode(back.toJson()), jsonEncode(r.toJson()));
      expect(back.at, r.at);
      expect(CallRecord.fromJson({'id': 'x'}), isNull);
    });

    test('the history: newest first, the same call once, at most 20 per course, kept across launches', () async {
      final container = await testContainer();
      addTearDown(container.dispose);
      final history = container.read(callHistoryProvider.notifier);
      final t0 = DateTime.utc(2026, 11, 1);
      for (var i = 0; i < 22; i++) {
        history.add(record('es-$i', t0.add(Duration(hours: i))));
      }
      history.add(record('ja-0', t0, course: 'japanese|en'));
      history.add(record('es-21', t0.add(const Duration(hours: 30))));
      final es = container.read(courseCallsProvider(courseId));
      expect(es, hasLength(20));
      expect(es.first.id, 'es-21', reason: 'replaced, now the newest');
      expect(es.map((r) => r.id), isNot(contains('es-0')), reason: 'the oldest dropped');
      expect(container.read(courseCallsProvider('japanese|en')).single.id, 'ja-0', reason: 'other courses keep theirs');

      history.remove('es-21');
      expect(container.read(courseCallsProvider(courseId)).first.id, 'es-20');

      // A new launch reads them back.
      final prefs = container.read(callHistoryProvider);
      final again = ProviderContainer(overrides: [learnerStoreProvider.overrideWithValue(container.read(learnerStoreProvider))]);
      addTearDown(again.dispose);
      expect(again.read(callHistoryProvider).map((r) => r.id), prefs.map((r) => r.id));

      history.clear();
      expect(container.read(callHistoryProvider), isEmpty);
    });
  });

  group('Speak tab: recent calls', () {
    Future<ProviderContainer> pump(WidgetTester t, {FakeConversationServer? server, String route = '/call/$missionKey'}) async {
      t.view.physicalSize = const Size(390 * 3, 844 * 3);
      t.view.devicePixelRatio = 3;
      addTearDown(t.view.reset);
      final api = LangQuestApi(baseUrl: 'https://api.test', accessToken: () async => 't', client: (server ?? FakeConversationServer()).client);
      await t.pumpWidget(
        ProviderScope(
          overrides: [
            ...await testOverrides(),
            liveCallCourseProvider.overrideWithValue(course),
            apiProvider.overrideWithValue(api),
            takeRecorderFactoryProvider.overrideWithValue(() => FakeRecorder(take: FakeTake())),
            clipPlayerFactoryProvider.overrideWithValue(() => FakeClipPlayer(instant: true)),
            courseCharactersProvider.overrideWith((ref) async => [CourseCharacter(id: pabloId, name: 'Pablo', role: 'Schoolboy')]),
          ],
          child: const LangQuestApp(),
        ),
      );
      final container = ProviderScope.containerOf(t.element(find.byType(LangQuestApp)));
      container.read(appStateProvider.notifier)
        ..setReduceMotion(true)
        ..enroll('spanish-spain', 'en');
      container.read(appRouterProvider).go(route);
      await settle(t, 1200);
      return container;
    }

    testWidgets('a call ends; the Speak tab lists it; its page has the goals, corrections and conversation; Call again; Delete', (t) async {
      final semantics = t.ensureSemantics();
      final server = FakeConversationServer(
        turns: [
          const ScriptedTurn(heard: 'Hola, yo llamo Alex', reply: '¡Encantado, Alex!', objectives: ['greet']),
        ],
      );
      final container = await pump(t, server: server);
      await tapLabel(t, 'Call', ms: 1500);
      await tapLabel(t, 'Talk');
      await tapLabel(t, 'Send', ms: 1500);
      await tapLabel(t, 'Hang up', ms: 1500);
      expect(find.textContaining('Call ended'), findsOneWidget);
      expect(container.read(callHistoryProvider), hasLength(1));

      container.read(appRouterProvider).go('/talk');
      await settle(t);
      expect(find.text('Recent calls'), findsOneWidget);
      final tile = find.bySemanticsLabel(RegExp(r'^Call with Pablo, .+, 0:\d\d, Greet and introduce yourself, Goals met: 1 of 2, 1 correction$'));
      expect(tile, findsOneWidget);
      await t.ensureVisible(tile);
      await t.tap(tile);
      await settle(t);

      // The record: goals, the server's summary, the correction, the conversation.
      expect(find.text('Goals met: 1 of 2'), findsOneWidget);
      expect(find.text('Greet Pablo'), findsOneWidget);
      expect(find.text('Say your name'), findsOneWidget);
      expect(find.text('You greeted Pablo and said your name.'), findsOneWidget);
      expect(find.text('Next time, try'), findsOneWidget);
      expect(find.text('Me llamo Alex.'), findsOneWidget);
      expect(find.text('The conversation'), findsOneWidget);
      expect(find.bySemanticsLabel('You: Hola, yo llamo Alex'), findsOneWidget);
      expect(find.bySemanticsLabel('Pablo: ¡Encantado, Alex!'), findsOneWidget);
      expect(find.text('Kept on this device only. “Reset all progress” deletes it.'), findsOneWidget);
      await expectLater(t, meetsGuideline(labeledTapTargetGuideline));

      // Call again opens the mission's call.
      await tapLabel(t, 'Call again');
      expect(find.text('Practise it in a real conversation'), findsOneWidget);
      container.read(appRouterProvider).pop();
      await settle(t);

      // Delete, after confirming.
      await t.ensureVisible(find.text('Delete this call'));
      await t.tap(find.text('Delete this call'));
      await settle(t, 400);
      expect(find.text('Delete this call?'), findsOneWidget);
      await t.tap(find.text('Delete'));
      await settle(t);
      expect(container.read(callHistoryProvider), isEmpty);
      expect(find.text('Recent calls'), findsNothing);
      semantics.dispose();
    });

    testWidgets('a call hung up in silence is not kept', (t) async {
      final container = await pump(t);
      await tapLabel(t, 'Call', ms: 1500);
      await tapLabel(t, 'Hang up', ms: 1500);
      expect(container.read(callHistoryProvider), isEmpty);
    });

    testWidgets('"Reset all progress" deletes the calls, what was said out loud and the lessons heard', (t) async {
      final container = await pump(t, route: '/account');
      container.read(callHistoryProvider.notifier).add(record('es-1', DateTime.utc(2026, 11, 10)));
      container.read(speakingStatsProvider.notifier).recordCheck(courseId, understood: true);
      container.read(audioListenedProvider.notifier).markListened(courseId, missionKey);
      await settle(t);
      final reset = find.text('Reset all progress');
      await t.scrollUntilVisible(reset, 300, scrollable: find.byType(Scrollable).first);
      await t.tap(reset);
      await settle(t, 400);
      expect(find.text('All courses, reviews, XP and calls on this device are deleted.'), findsOneWidget);
      await t.tap(find.text('Reset').last);
      await settle(t);
      expect(container.read(callHistoryProvider), isEmpty);
      expect(container.read(speakingStatsProvider), isEmpty);
      expect(container.read(audioListenedProvider), isEmpty);
    });

    testWidgets('a record that is gone says so', (t) async {
      await pump(t, route: '/calls/nothing-here');
      expect(find.text('This call is no longer on this device.'), findsOneWidget);
    });
  });
}
