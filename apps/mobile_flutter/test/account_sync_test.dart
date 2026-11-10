// Reads the content bundle from disk (dart:io): VM only.
@TestOn('vm')
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:langquest_mobile/core/backend/account.dart';
import 'package:langquest_mobile/core/backend/api_client.dart';
import 'package:langquest_mobile/core/backend/auth_gateway.dart';
import 'package:langquest_mobile/core/backend/backend_config.dart';
import 'package:langquest_mobile/core/backend/curriculum_ids.dart';
import 'package:langquest_mobile/core/backend/sync_service.dart';
import 'package:langquest_mobile/core/content/content_models.dart';
import 'package:langquest_mobile/core/learning/srs.dart';
import 'package:langquest_mobile/core/services/app_state.dart';
import 'package:langquest_mobile/features/account/account_section.dart';
import 'package:langquest_mobile/features/learn/learn_logic.dart';
import 'package:langquest_mobile/l10n/generated/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support.dart';

/// The signed-in learner and their completed missions, in memory.
class FakeAuth implements AuthGateway {
  FakeAuth({this.user});

  AccountUser? user;
  final _changes = StreamController<AccountUser?>.broadcast();
  final Map<String, Set<String>> completedByEnrollment = {};
  String? refuseWith;

  @override
  AccountUser? get currentUser => user;
  @override
  Stream<AccountUser?> get userChanges => _changes.stream;
  @override
  Future<String?> accessToken() async => user == null ? null : 'token-of-${user!.id}';
  @override
  Future<void> signIn(String email, String password) async {
    if (refuseWith != null) throw AuthFailure(refuseWith!);
    user = AccountUser(id: 'u-1', email: email);
    _changes.add(user);
  }

  @override
  Future<SignUpResult> signUp(String email, String password, {required String uiLocale, required String sourceLanguage}) async => SignUpResult.confirmEmail;
  @override
  Future<void> signOut() async {
    user = null;
    _changes.add(null);
  }

  @override
  Future<Set<String>> completedMissionIds(String enrollmentId) async => completedByEnrollment[enrollmentId] ?? {};
}

/// A Worker answering the learner routes from memory; every request is logged as `METHOD /path`.
class FakeWorker {
  final requests = <String>[];
  final bodies = <String, List<Map<String, Object?>>>{};
  final enrollments = <Map<String, Object?>>[];
  final failNext = <String, int>{};
  var healthy = true;

  http.Client get client => MockClient((req) async {
    final key = '${req.method} ${req.url.path}';
    requests.add(key);
    if (req.body.isNotEmpty) (bodies[key] ??= []).add((jsonDecode(req.body) as Map).cast<String, Object?>());
    Map<String, Object?> ok(Object? data, [int status = 200]) => {'ok': true, 'data': data};
    http.Response json(Map<String, Object?> body, [int status = 200]) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});
    if (failNext[key] case final n? when n > 0) {
      failNext[key] = n - 1;
      return json({
        'ok': false,
        'error': {'code': 'internal', 'message': 'boom'},
      }, 500);
    }
    if (key == 'GET /healthz') {
      return healthy
          ? json(ok({'status': 'ok'}))
          : json({
              'ok': false,
              'error': {'code': 'provider_unavailable', 'message': 'not configured'},
            }, 503);
    }
    expect(req.headers['Authorization'], startsWith('Bearer token-of-'));
    if (key == 'GET /v1/me') return json(ok({'enrollments': enrollments}));
    if (key == 'POST /v1/me/enrollments') {
      final body = jsonDecode(req.body) as Map;
      if (enrollments.any((e) => e['courseTrackId'] == body['courseTrackId'] && e['status'] == 'active')) {
        return json({
          'ok': false,
          'error': {'code': 'conflict', 'message': 'active enrollment exists'},
        }, 409);
      }
      final created = {'id': 'enr-${enrollments.length + 1}', 'courseTrackId': body['courseTrackId'], 'sourceLanguageCode': body['sourceLanguageCode'], 'status': 'active'};
      enrollments.add(created);
      return json(ok(created), 201);
    }
    if (req.method == 'GET' && req.url.path.startsWith('/v1/missions/')) {
      final missionId = req.url.pathSegments[2];
      final mission = testBundle.chapters.expand((c) => c.missions).firstWhere((m) => missionServerId(m.chapterKey, m.key) == missionId);
      // Two steps built on the learner's lines, one listening step on the character's.
      final learner = mission.expressions.where((e) => e.byLearner).toList();
      final character = mission.expressions.where((e) => !e.byLearner).toList();
      return json(
        ok({
          'id': missionId,
          'revision': 3,
          'steps': [
            {
              'id': 's-listen',
              'expressions': [
                for (final e in character.take(1)) {'id': expressionServerId(e.id)},
              ],
            },
            {
              'id': 's-say-1',
              'expressions': [
                for (final e in learner.take(1)) {'id': expressionServerId(e.id)},
              ],
            },
            {
              'id': 's-say-2',
              'expressions': [
                for (final e in learner.skip(1)) {'id': expressionServerId(e.id)},
              ],
            },
          ],
        }),
      );
    }
    if (req.method == 'POST' && req.url.path.endsWith('/attempts')) return json(ok({'attemptId': 'att-1', 'replayed': false}), 201);
    if (req.method == 'POST' && req.url.path.endsWith('/evaluate')) {
      return json(
        ok({
          'xpAwarded': 0,
          'credit': {'missionCredited': false},
        }),
      );
    }
    return json({
      'ok': false,
      'error': {'code': 'not_found', 'message': key},
    }, 404);
  });
}

const spanish = 'spanish-spain';

void main() {
  late FakeWorker worker;
  late FakeAuth auth;
  late ProviderContainer container;
  late SyncService sync;
  late TestClock clock;

  Future<void> setUpSync({AccountUser? user = const AccountUser(id: 'u-1', email: 'learner@example.test')}) async {
    worker = FakeWorker();
    auth = FakeAuth(user: user);
    clock = TestClock();
    container = await testContainer(clock: clock);
    final api = LangQuestApi(baseUrl: 'https://api.test', accessToken: auth.accessToken, client: worker.client);
    sync = SyncService(api: api, auth: auth, ledger: SyncLedger(await SharedPreferences.getInstance()), target: container.read(appStateProvider.notifier), now: clock.call);
  }

  AppStateNotifier app() => container.read(appStateProvider.notifier);
  Mission firstMission(String track, String source) => testBundle.course(track, source)!.missions.first;

  void completeFirstMission(String track, String source) {
    final m = firstMission(track, source);
    app().missionOpened(m.key);
    clock.advance(const Duration(minutes: 4));
    app().completeMission(m.key, {for (final e in m.expressions.where((e) => e.byLearner)) e.id: ReviewRating.good});
  }

  group('ids', () {
    test('mission and expression ids match the seed (uuid v5 vectors from Python uuid.uuid5)', () {
      expect(missionServerId('es_es_ch1_arrival_madrid', 'es_greet_and_introduce'), '4e4a1d03-3dd3-5585-82c9-7c148a551e9e');
      expect(missionServerId('ary_ch1_arrival_casablanca', 'ary_greet_and_introduce'), 'fe3f3825-77bb-54fe-9f7e-983983f18313');
      expect(expressionServerId('es_es_ch1_arrival_madrid:es_greet_and_introduce:hola'), 'bf0c634b-f74c-5b3a-bcb9-3cab98087e10');
    });
  });

  group('config', () {
    test('a half-configured build stays offline; a trailing slash is dropped', () {
      expect(BackendConfig.from(supabaseUrl: 'https://sb.test', supabaseAnonKey: 'anon', apiBaseUrl: ''), isNull);
      expect(BackendConfig.fromJson({'supabaseUrl': 'https://sb.test', 'supabaseAnonKey': ' ', 'apiBaseUrl': 'https://api.test'}), isNull);
      expect(BackendConfig.fromJson({'supabaseUrl': 'https://sb.test', 'supabaseAnonKey': 'anon', 'apiBaseUrl': 'https://api.test//'})!.apiBaseUrl, 'https://api.test');
    });
  });

  group('sync', () {
    test('a course and a mission done on this device are sent once, with honest step outcomes', () async {
      await setUpSync();
      app().enroll(spanish, 'en');
      completeFirstMission(spanish, 'en');
      final xpBefore = container.read(appStateProvider).learner.xpByDay.values.fold<int>(0, (a, b) => a + b);

      final report = await sync.sync();
      expect(report.coursesSent, 1);
      expect(report.missionsSent, 1);
      final missionId = missionServerId(firstMission(spanish, 'en').chapterKey, firstMission(spanish, 'en').key);
      expect(worker.requests, [
        'GET /v1/me',
        'POST /v1/me/enrollments',
        'GET /v1/missions/$missionId',
        'POST /v1/missions/$missionId/attempts',
        'POST /v1/missions/$missionId/evaluate',
      ]);
      expect(worker.bodies['POST /v1/me/enrollments']!.single, {'courseTrackId': spanish, 'sourceLanguageCode': 'en'});
      final attempt = worker.bodies['POST /v1/missions/$missionId/attempts']!.single;
      expect(attempt['missionRevision'], 3);
      expect(DateTime.parse(attempt['startedAt'] as String), testNow.toUtc(), reason: 'the mission stop opened at the start');
      final evaluation = worker.bodies['POST /v1/missions/$missionId/evaluate']!.single;
      expect(DateTime.parse(evaluation['completedAt'] as String), testNow.add(const Duration(minutes: 4)).toUtc());
      final outcomes = {for (final s in evaluation['stepResults'] as List) (s as Map)['stepId']: s['outcome']};
      expect(outcomes, {'s-listen': 'unclear', 's-say-1': 'success', 's-say-2': 'success'}, reason: 'only what the learner did here is claimed');
      expect((evaluation['stepResults'] as List).every((s) => (s as Map)['speechAssessmentIds'] is List && s['hintsUsed'] == 0), isTrue);

      // Nothing new: nothing sent again. Local XP is untouched by syncing.
      worker.requests.clear();
      final again = await sync.sync();
      expect(again.coursesSent + again.missionsSent, 0);
      expect(worker.requests, ['GET /v1/me']);
      expect(container.read(appStateProvider).learner.xpByDay.values.fold<int>(0, (a, b) => a + b), xpBefore);
    });

    test('ids sent to the server are deterministic, so an interrupted sync replays instead of duplicating', () async {
      await setUpSync();
      app().enroll(spanish, 'en');
      completeFirstMission(spanish, 'en');
      final missionId = missionServerId(firstMission(spanish, 'en').chapterKey, firstMission(spanish, 'en').key);
      worker.failNext['POST /v1/missions/$missionId/evaluate'] = 1;
      await expectLater(sync.sync(), throwsA(isA<ApiException>().having((e) => e.isTransient, 'transient', isTrue)));
      final report = await sync.sync();
      expect(report.missionsSent, 1, reason: 'retried after the server error');
      final attempts = worker.bodies['POST /v1/missions/$missionId/attempts']!;
      final evaluations = worker.bodies['POST /v1/missions/$missionId/evaluate']!;
      expect(attempts[0]['clientAttemptId'], attempts[1]['clientAttemptId']);
      expect(evaluations[0]['clientEventId'], evaluations[1]['clientEventId']);
    });

    test('courses and completed missions of the account come back on a new device, without XP or review cards', () async {
      await setUpSync();
      final darija = testBundle.course('arabic-moroccan', 'fr')!;
      worker.enrollments.add({'id': 'enr-9', 'courseTrackId': 'arabic-moroccan', 'sourceLanguageCode': 'fr', 'status': 'active'});
      worker.enrollments.add({'id': 'enr-old', 'courseTrackId': 'japanese', 'sourceLanguageCode': 'en', 'status': 'archived'});
      auth.completedByEnrollment['enr-9'] = {for (final m in darija.missions.take(2)) missionServerId(m.chapterKey, m.key)};

      final report = await sync.sync();
      expect(report.coursesRestored, 1);
      expect(report.missionsRestored, 2);
      final state = container.read(appStateProvider);
      expect(state.learner.isEnrolled('arabic-moroccan', 'fr'), isTrue);
      expect(state.learner.isEnrolled('japanese', 'en'), isFalse, reason: 'archived in the account');
      expect(state.activeCourse!.id, darija.id);
      final progress = state.learner.progressOf(darija.id);
      expect(progress.isMissionCompleted(darija.missions[0].key) && progress.isMissionCompleted(darija.missions[1].key), isTrue);
      expect(progress.stopsDone(darija.missions[0].key), {PathStop.learn, PathStop.practise, PathStop.mission});
      expect(state.isUnlocked(darija, darija.missions[2].key), isTrue, reason: 'the path continues where the account left off');
      expect(progress.cards, isEmpty);
      expect(state.learner.xpByDay, isEmpty);
      expect(worker.requests.where((r) => r.contains('/evaluate')), isEmpty, reason: 'restored missions are not sent back');
    });

    test('a course the account refuses (another source of the track is active) is reported, not retried as an error', () async {
      await setUpSync();
      worker.enrollments.add({'id': 'enr-1', 'courseTrackId': 'arabic-moroccan', 'sourceLanguageCode': 'en', 'status': 'active'});
      app().enroll('arabic-moroccan', 'fr');
      final report = await sync.sync();
      expect(report.coursesNotSaved, ['arabic-moroccan|fr']);
      expect(container.read(appStateProvider).learner.isEnrolled('arabic-moroccan', 'en'), isTrue, reason: 'the account course still comes here');
    });

    test('signed out: nothing is sent', () async {
      await setUpSync(user: null);
      app().enroll(spanish, 'en');
      expect((await sync.sync()).coursesSent, 0);
      expect(worker.requests, isEmpty);
    });
  });

  group('settings', () {
    Future<void> pumpSection(WidgetTester tester, {required bool healthy}) async {
      worker = FakeWorker()..healthy = healthy;
      auth = FakeAuth();
      final overrides = [
        ...await testOverrides(),
        backendConfigProvider.overrideWithValue(const BackendConfig(supabaseUrl: 'https://sb.test', supabaseAnonKey: 'anon', apiBaseUrl: 'https://api.test')),
        authGatewayProvider.overrideWithValue(auth),
        apiProvider.overrideWithValue(LangQuestApi(baseUrl: 'https://api.test', accessToken: auth.accessToken, client: worker.client)),
      ];
      await tester.pumpWidget(
        ProviderScope(
          overrides: overrides,
          child: const MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Scaffold(body: SingleChildScrollView(child: AccountSection())),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
    }

    testWidgets('no account section while the API is not answering (visible means usable)', (tester) async {
      await pumpSection(tester, healthy: false);
      expect(find.text('Sign in'), findsNothing);
      expect(find.byType(TextField), findsNothing);
    });

    testWidgets('sign in from Settings, then the section says who is signed in', (tester) async {
      await pumpSection(tester, healthy: true);
      expect(find.text('Sign in'), findsOneWidget);
      await tester.enterText(find.byType(TextField).first, 'learner@example.test');
      await tester.enterText(find.byType(TextField).last, 'a long password');
      await tester.tap(find.text('Sign in'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      expect(find.text('Signed in as learner@example.test'), findsOneWidget);
      expect(find.text('Sign out'), findsOneWidget);
      expect(find.textContaining('Practice XP and your review schedule stay on this device'), findsOneWidget);
      await tester.pump(const Duration(seconds: 3));
    });

    testWidgets('a refused sign-in shows the server’s reason and stays signed out', (tester) async {
      await pumpSection(tester, healthy: true);
      auth.refuseWith = 'Invalid login credentials';
      await tester.enterText(find.byType(TextField).first, 'learner@example.test');
      await tester.enterText(find.byType(TextField).last, 'wrong');
      await tester.tap(find.text('Sign in'));
      await tester.pump();
      expect(find.text('Invalid login credentials'), findsOneWidget);
      expect(find.text('Sign out'), findsNothing);
    });
  });
}
