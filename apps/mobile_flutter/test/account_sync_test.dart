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
import 'package:langquest_mobile/core/content/content_bundle.dart';
import 'package:langquest_mobile/core/content/content_models.dart';
import 'package:langquest_mobile/core/learning/srs.dart';
import 'package:langquest_mobile/core/services/app_state.dart';
import 'package:langquest_mobile/features/account/account_section.dart';
import 'package:langquest_mobile/features/account/email_link_prompt.dart';
import 'package:langquest_mobile/features/learn/learn_logic.dart';
import 'package:langquest_mobile/l10n/generated/app_localizations.dart';
import 'package:langquest_mobile/navigation/app_router.dart';
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
  Future<SignUpResult> signUp(String email, String password, {required String uiLocale, required String sourceLanguage, String? redirectTo}) async {
    signUpRedirects.add(redirectTo);
    return SignUpResult.confirmEmail;
  }

  @override
  Future<void> signOut() async {
    user = null;
    _changes.add(null);
  }

  /// `email → redirectTo` of each password-reset request.
  final resets = <String, String?>{};
  final signUpRedirects = <String?>[];
  String? newPassword;

  /// What [openEmailLink] does: sign in and answer this kind, or refuse with this message.
  EmailLink linkKind = EmailLink.confirmed;
  String? refuseLinkWith;

  @override
  Future<void> sendPasswordReset(String email, {String? redirectTo}) async => resets[email] = redirectTo;

  @override
  Future<void> updatePassword(String password) async {
    if (refuseWith != null) throw AuthFailure(refuseWith!);
    newPassword = password;
  }

  @override
  Future<EmailLink> openEmailLink(Uri uri) async {
    if (refuseLinkWith != null) throw AuthFailure(refuseLinkWith!);
    user = const AccountUser(id: 'u-1', email: 'learner@example.test');
    _changes.add(user);
    return linkKind;
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

  /// Chapters the server's curriculum does not have (yet): their missions answer 404.
  final unknownChapters = <String>{};

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
    if (key == 'GET /v1/me/export') {
      return json(ok({'exportedAt': '2026-11-10T09:00:00Z', 'profile': {'userId': 'u-1'}, 'enrollments': enrollments, 'notes': <String>[]}));
    }
    if (key == 'DELETE /v1/me') return json(ok({'status': 'deleted', 'anonymisedTables': <String>[], 'retainedForLegalReasons': <String>[]}));
    if (key == 'POST /v1/me/enrollments') {
      final body = jsonDecode(req.body) as Map;
      if (enrollments.any((e) => e['courseTrackId'] == body['courseTrackId'] && e['status'] == 'active')) {
        return json({
          'ok': false,
          'error': {'code': 'conflict', 'message': 'active enrollment exists'},
        }, 409);
      }
      final created = {
        'id': 'enr-${enrollments.length + 1}',
        'courseTrackId': body['courseTrackId'],
        'sourceLanguageCode': body['sourceLanguageCode'],
        'targetVarietyId': 'variety-of-${body['courseTrackId']}',
        'status': 'active',
        'capabilities': {
          'liveConversation': {'available': true, 'characterCount': 3, 'mode': 'text_and_voice'},
          'pronunciationScoring': {'mode': 'reference_comparison'},
          'audioLibrary': {'available': false, 'publishedCollections': 0},
        },
      };
      enrollments.add(created);
      return json(ok(created), 201);
    }
    if (req.method == 'GET' && req.url.path.startsWith('/v1/missions/')) {
      final missionId = req.url.pathSegments[2];
      final mission = testBundle.chapters.expand((c) => c.missions).firstWhere((m) => missionServerId(m.chapterKey, m.key) == missionId);
      if (unknownChapters.contains(mission.chapterKey)) {
        return json({
          'ok': false,
          'error': {'code': 'not_found', 'message': 'mission not found'},
        }, 404);
      }
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

  Future<void> setUpSync({AccountUser? user = const AccountUser(id: 'u-1', email: 'learner@example.test'), ContentBundle? content}) async {
    worker = FakeWorker();
    auth = FakeAuth(user: user);
    clock = TestClock();
    container = await testContainer(clock: clock, content: content);
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
      // An unfilled server template (served raw by a dev server) is not a backend.
      expect(
        BackendConfig.fromJson({'supabaseUrl': '{{or (env `LQ_SUPABASE_URL`) (env `NEXT_PUBLIC_SUPABASE_URL`)}}', 'supabaseAnonKey': '{{env `K`}}', 'apiBaseUrl': '{{env `A`}}'}),
        isNull,
      );
      expect(BackendConfig.from(supabaseUrl: 'sb.test', supabaseAnonKey: 'anon', apiBaseUrl: 'https://api.test'), isNull, reason: 'no scheme');
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
      // What the server's AI can do for the course, from its snapshot: the speech check and live calls are offered.
      final course = report.courses['$spanish|en']!;
      expect((course.enrollmentId, course.speechCheck, course.liveConversation, course.audioLibrary), ('enr-1', true, true, false));
      final missionId = missionServerId(firstMission(spanish, 'en').chapterKey, firstMission(spanish, 'en').key);
      expect(worker.requests, [
        'GET /v1/me',
        'POST /v1/me/enrollments',
        'GET /v1/me', // the new course's capability snapshot
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

    test('a mission of a chapter the server does not have yet waits on the device and is sent once it does', () async {
      await setUpSync();
      app().enroll(spanish, 'en');
      final missions = testBundle.course(spanish, 'en')!.missions;
      for (final m in missions.take(2)) {
        app().completeMission(m.key, {for (final e in m.expressions.where((e) => e.byLearner)) e.id: ReviewRating.good});
      }
      worker.unknownChapters.add(missions.first.chapterKey);

      final report = await sync.sync();
      expect((report.missionsSent, report.missionsWaiting, report.missionsRefused), (0, 2, 0));
      expect(worker.requests.where((r) => r.startsWith('GET /v1/missions/')), hasLength(1), reason: 'the chapter is asked about once, not once per mission');
      expect(container.read(appStateProvider).progress.isMissionCompleted(missions.first.key), isTrue, reason: 'nothing is lost on the device');

      // The server's curriculum catches up: the next sync reports both.
      worker.unknownChapters.clear();
      final later = await sync.sync();
      expect((later.missionsSent, later.missionsWaiting), (2, 0));
      expect((await sync.sync()).missionsSent, 0, reason: 'sent once');
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
      expect(progress.stopsDone(darija.missions[0].key), {PathStop.learn, PathStop.practise, PathStop.play, PathStop.mission});
      expect(state.isUnlocked(darija, darija.missions[2].key), isTrue, reason: 'the path continues where the account left off');
      expect(progress.cards, isEmpty);
      expect(state.learner.xpByDay, isEmpty);
      expect(worker.requests.where((r) => r.contains('/evaluate')), isEmpty, reason: 'restored missions are not sent back');
    });

    test('on a device that has read no course yet, an account course is read first, then restored with its missions', () async {
      await setUpSync(content: await startupBundle());
      expect(container.read(appStateProvider).content.chapters, isEmpty);
      final darija = testBundle.course('arabic-moroccan', 'fr')!;
      worker.enrollments.add({'id': 'enr-9', 'courseTrackId': 'arabic-moroccan', 'sourceLanguageCode': 'fr', 'status': 'active'});
      auth.completedByEnrollment['enr-9'] = {missionServerId(darija.missions.first.chapterKey, darija.missions.first.key)};

      final report = await sync.sync();
      expect((report.coursesRestored, report.missionsRestored), (1, 1));
      final state = container.read(appStateProvider);
      expect(state.content.isLoaded('arabic-moroccan'), isTrue);
      expect({for (final c in state.content.chapters) c.courseTrackId}, {'arabic-moroccan'}, reason: 'only the account\'s course');
      expect(state.activeCourse?.id, darija.id);
      expect(state.learner.progressOf(darija.id).isMissionCompleted(darija.missions.first.key), isTrue);
    });

    test('an account course that cannot be read now is left for a later sync, which restores it', () async {
      var failing = true;
      Future<String> read(String path) => failing && path == ContentBundle.chaptersAsset(spanish) ? Future.error(FlutterError('offline')) : readTestAsset(path);
      worker = FakeWorker();
      auth = FakeAuth(
        user: const AccountUser(id: 'u-1', email: 'learner@example.test'),
      );
      clock = TestClock();
      container = await testContainer(clock: clock, content: await startupBundle(), read: read);
      sync = SyncService(
        api: LangQuestApi(baseUrl: 'https://api.test', accessToken: auth.accessToken, client: worker.client),
        auth: auth,
        ledger: SyncLedger(await SharedPreferences.getInstance()),
        target: container.read(appStateProvider.notifier),
        now: clock.call,
      );
      worker.enrollments.add({'id': 'enr-3', 'courseTrackId': spanish, 'sourceLanguageCode': 'en', 'status': 'active'});

      var report = await sync.sync();
      expect(report.coursesRestored, 0, reason: 'its chapters could not be read');
      expect(container.read(appStateProvider).learner.isEnrolled(spanish, 'en'), isFalse);

      failing = false;
      report = await sync.sync();
      expect(report.coursesRestored, 1);
      expect(container.read(appStateProvider).activeCourse?.id, '$spanish|en');
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
    Future<void> pumpSection(WidgetTester tester, {required bool healthy, AccountUser? user}) async {
      worker = FakeWorker()..healthy = healthy;
      auth = FakeAuth(user: user);
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

    testWidgets('deleting the account takes the typed word, calls the server, then signs out', (tester) async {
      await pumpSection(tester, healthy: true, user: const AccountUser(id: 'u-1', email: 'learner@example.test'));
      expect(find.text('Export my data'), findsNothing, reason: 'no file download outside the browser in this build');
      await tester.tap(find.text('Delete my account'));
      await tester.pumpAndSettle();
      expect(find.text('Delete your account?'), findsOneWidget);
      final confirm = find.descendant(of: find.byType(AlertDialog), matching: find.widgetWithText(TextButton, 'Delete my account'));
      expect(tester.widget<TextButton>(confirm).onPressed, isNull, reason: 'nothing happens before the word is typed');
      await tester.enterText(find.descendant(of: find.byType(AlertDialog), matching: find.byType(TextField)), 'delete');
      await tester.pump();
      expect(tester.widget<TextButton>(confirm).onPressed, isNotNull);
      await tester.tap(confirm);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      expect(worker.bodies['DELETE /v1/me']!.single, {'confirmation': 'DELETE', 'deleteOptInRecordings': true});
      expect(auth.user, isNull, reason: 'signed out only after the server confirmed');
      expect(find.text('Your account was deleted.'), findsOneWidget);
      expect(find.text('Sign in'), findsOneWidget);
    });

    testWidgets('a refused deletion keeps the learner signed in and says why', (tester) async {
      await pumpSection(tester, healthy: true, user: const AccountUser(id: 'u-1', email: 'learner@example.test'));
      worker.failNext['DELETE /v1/me'] = 1;
      await tester.tap(find.text('Delete my account'));
      await tester.pumpAndSettle();
      await tester.enterText(find.descendant(of: find.byType(AlertDialog), matching: find.byType(TextField)), 'DELETE');
      await tester.pump();
      await tester.tap(find.descendant(of: find.byType(AlertDialog), matching: find.widgetWithText(TextButton, 'Delete my account')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      expect(auth.user, isNotNull);
      expect(find.text('Sign out'), findsOneWidget);
      expect(find.text('boom'), findsOneWidget);
      await tester.pump(const Duration(seconds: 3));
    });

    testWidgets('forgot password needs the address, then asks the server for a reset link', (tester) async {
      await pumpSection(tester, healthy: true);
      await tester.tap(find.text('Forgot password?'));
      await tester.pump();
      expect(find.text('Enter your email address first.'), findsOneWidget);
      expect(auth.resets, isEmpty);
      await tester.enterText(find.byType(TextField).first, 'learner@example.test');
      await tester.tap(find.text('Forgot password?'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      expect(auth.resets.keys, ['learner@example.test']);
      expect(auth.resets['learner@example.test'], isNull, reason: 'no link target outside the web app: the server’s Site URL applies');
      expect(find.text('If an account uses this address, an email with a link to choose a new password is on its way.'), findsOneWidget);
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

  group('email links', () {
    test('a link back from an email is told apart from the app’s own routes', () {
      expect(isEmailLink(Uri.parse('https://web.test/?code=0b1d')), isTrue);
      expect(isEmailLink(Uri.parse('https://web.test/?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid')), isTrue);
      expect(isEmailLink(Uri.parse('https://web.test/#error=access_denied&error_code=otp_expired&error_description=expired')), isTrue);
      expect(isEmailLink(Uri.parse('https://web.test/#access_token=a&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery')), isTrue);
      expect(isEmailLink(Uri.parse('https://web.test/#/missions')), isFalse);
      expect(isEmailLink(Uri.parse('https://web.test/')), isFalse);
      expect(isEmailLink(Uri.parse('https://web.test/#/course/japanese')), isFalse);
    });

    test('opening a link never throws: a refused one is an outcome with the server’s reason', () async {
      final refused = await openStartupEmailLink(FakeAuth()..refuseLinkWith = 'Email link is invalid or has expired', Uri.parse('https://web.test/?code=x'));
      expect([refused.kind, refused.error], [null, 'Email link is invalid or has expired']);
      final recovery = await openStartupEmailLink(FakeAuth()..linkKind = EmailLink.passwordRecovery, Uri.parse('https://web.test/?code=x'));
      expect(recovery.kind, EmailLink.passwordRecovery);
    });

    Future<FakeAuth> pumpWithLink(WidgetTester tester, EmailLinkOutcome outcome, {AccountUser? user}) async {
      final worker = FakeWorker();
      final auth = FakeAuth(user: user);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            ...await testOverrides(),
            backendConfigProvider.overrideWithValue(const BackendConfig(supabaseUrl: 'https://sb.test', supabaseAnonKey: 'anon', apiBaseUrl: 'https://api.test')),
            authGatewayProvider.overrideWithValue(auth),
            apiProvider.overrideWithValue(LangQuestApi(baseUrl: 'https://api.test', accessToken: auth.accessToken, client: worker.client)),
            startupEmailLinkProvider.overrideWithValue(outcome),
          ],
          child: MaterialApp(
            navigatorKey: rootNavigatorKey,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            builder: (context, child) => EmailLinkPrompt(child: child!),
            home: const Scaffold(body: SizedBox()),
          ),
        ),
      );
      await tester.pumpAndSettle();
      return auth;
    }

    testWidgets('a confirmation link says the learner is signed in', (tester) async {
      await pumpWithLink(tester, const EmailLinkOutcome(EmailLink.confirmed), user: const AccountUser(id: 'u-1', email: 'learner@example.test'));
      expect(find.text('Email confirmed. You\'re signed in.'), findsOneWidget);
      await tester.pump(const Duration(seconds: 10));
    });

    testWidgets('a refused link says why and where to ask for a new one', (tester) async {
      await pumpWithLink(tester, const EmailLinkOutcome.failed('Email link is invalid or has expired'));
      expect(find.textContaining('This email link can\'t be used'), findsOneWidget);
      await tester.pump(const Duration(seconds: 10));
    });

    testWidgets('a password-reset link asks for the new password and saves it', (tester) async {
      final auth = await pumpWithLink(tester, const EmailLinkOutcome(EmailLink.passwordRecovery), user: const AccountUser(id: 'u-1', email: 'learner@example.test'));
      expect(find.text('Choose a new password'), findsOneWidget);
      expect(find.text('You opened a password reset link for learner@example.test.'), findsOneWidget);
      final save = find.widgetWithText(TextButton, 'Save password');
      expect(tester.widget<TextButton>(save).onPressed, isNull, reason: 'nothing to save yet');

      auth.refuseWith = 'Password should be at least 6 characters.';
      await tester.enterText(find.byType(TextField), 'short');
      await tester.pump();
      await tester.tap(save);
      await tester.pumpAndSettle();
      expect(find.text('Password should be at least 6 characters.'), findsOneWidget, reason: 'the server’s reason, in the dialog');
      expect(find.text('Choose a new password'), findsOneWidget);

      auth.refuseWith = null;
      await tester.enterText(find.byType(TextField), 'a much longer password');
      await tester.pump();
      await tester.tap(save);
      await tester.pumpAndSettle();
      expect(auth.newPassword, 'a much longer password');
      expect(find.text('Choose a new password'), findsNothing);
      expect(find.text('Your password was changed.'), findsOneWidget);
      await tester.pump(const Duration(seconds: 10));
    });
  });
}
