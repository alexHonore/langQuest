import 'dart:convert';

import 'package:flutter/foundation.dart' show debugPrint;
import 'package:shared_preferences/shared_preferences.dart';

import '../content/content_bundle.dart';
import '../content/content_models.dart';
import '../services/app_state.dart';
import 'api_client.dart';
import 'auth_gateway.dart';
import 'curriculum_ids.dart';
import 'server_course.dart';

/// What this device knows that the account may not: when each mission was done (recorded signed in or not, so a
/// later sign-in sends real times), and per account what has been sent already.
class SyncLedger {
  SyncLedger(this._prefs);

  final SharedPreferences _prefs;
  static const timesKey = 'langquest.sync.times.v1';
  static String sentKey(String userId) => 'langquest.sync.sent.v1.$userId';

  Map<String, Object?> _times() {
    try {
      final raw = jsonDecode(_prefs.getString(timesKey) ?? '{}');
      return raw is Map ? raw.cast<String, Object?>() : {};
    } on FormatException {
      return {};
    }
  }

  static String _key(String courseId, String missionKey) => '$courseId|$missionKey';

  void missionOpened(String courseId, String missionKey, DateTime at) {
    final times = _times();
    final entry = (times[_key(courseId, missionKey)] as Map?)?.cast<String, Object?>() ?? {};
    times[_key(courseId, missionKey)] = {...entry, 'openedAt': at.toUtc().toIso8601String()};
    _prefs.setString(timesKey, jsonEncode(times));
  }

  void missionCompleted(String courseId, String missionKey, DateTime at, {required bool firstTryEverywhere}) {
    final times = _times();
    final entry = (times[_key(courseId, missionKey)] as Map?)?.cast<String, Object?>() ?? {};
    times[_key(courseId, missionKey)] = {...entry, 'completedAt': at.toUtc().toIso8601String(), 'firstTry': firstTryEverywhere};
    _prefs.setString(timesKey, jsonEncode(times));
  }

  ({DateTime? openedAt, DateTime? completedAt, bool firstTry}) missionTimes(String courseId, String missionKey) {
    final entry = (_times()[_key(courseId, missionKey)] as Map?) ?? const {};
    DateTime? at(Object? v) => v is String ? DateTime.tryParse(v) : null;
    return (openedAt: at(entry['openedAt']), completedAt: at(entry['completedAt']), firstTry: entry['firstTry'] != false);
  }

  Set<String> sent(String userId) => {...?_prefs.getStringList(sentKey(userId))};

  Future<void> markSent(String userId, Iterable<String> keys) => _prefs.setStringList(sentKey(userId), {...sent(userId), ...keys}.toList()..sort());

  /// After the account is deleted: nothing of it is remembered on this device.
  Future<void> forget(String userId) => _prefs.remove(sentKey(userId));

  static String enrollmentKey(String courseId) => 'enroll:$courseId';
  static String missionKey(String courseId, String missionKey) => 'mission:${_key(courseId, missionKey)}';
}

/// What one sync did, for the settings screen.
class SyncReport {
  const SyncReport({
    this.coursesSent = 0,
    this.missionsSent = 0,
    this.coursesRestored = 0,
    this.missionsRestored = 0,
    this.coursesNotSaved = const [],
    this.missionsRefused = 0,
    this.missionsWaiting = 0,
    this.courses = const {},
    this.keepsRecordings = false,
  });

  final int coursesSent;
  final int missionsSent;
  final int coursesRestored;
  final int missionsRestored;

  /// Courses the account refused (`409`: another instruction language of the same track is active there).
  final List<String> coursesNotSaved;

  /// Missions the server refused for good; not retried.
  final int missionsRefused;

  /// Missions of a chapter the server does not have yet (the app's bundle is ahead of the server's curriculum):
  /// kept on the device and reported by a later sync, once the server knows them.
  final int missionsWaiting;

  /// The account's active courses by course id, with what the server's AI can do for each.
  final Map<String, ServerCourse> courses;

  /// The account keeps the learner's recordings (they opted in): said where a take is sent to be checked.
  final bool keepsRecordings;
}

/// Where restored data lands on this device ([AppStateNotifier] in the app).
abstract class RestoreTarget {
  AppState get current;

  /// Reads a course's chapters unless they are in memory (each course is a file of its own, read on demand).
  Future<void> loadCourse(String trackId);
  void restoreEnrollment(String trackId, String source);
  void restoreCompletedMissions(String courseId, Iterable<String> missionKeys);
}

/// Keeps the learner's account and this device in step:
///
/// * courses: enrolled here → created in the account; enrolled in the account → added here;
/// * missions: completed here → reported to the server (attempt + evaluation); completed in the account → their path
///   stops are marked done here, so the next mission unlocks on any device.
///
/// XP and the review schedule stay with the device that earned them: the server credits XP and creates review
/// cards only for steps it has evidence for — a take it checked itself (`speech_check.dart`, signed in), never a
/// claim — so the step outcomes sent here are claims it pays only where it holds that evidence. Every call is
/// idempotent on the server, so an interrupted sync is simply run again.
class SyncService {
  SyncService({required this.api, required this.auth, required this.ledger, required this.target, DateTime Function()? now}) : _now = now ?? DateTime.now;

  final LangQuestApi api;
  final AuthGateway auth;
  final SyncLedger ledger;
  final RestoreTarget target;
  final DateTime Function() _now;

  Future<SyncReport>? _running;

  /// One sync at a time; a call while one runs waits for it.
  Future<SyncReport> sync() => _running ??= _sync().whenComplete(() => _running = null);

  Future<SyncReport> _sync() async {
    final user = auth.currentUser;
    if (user == null) return const SyncReport();
    var coursesSent = 0, missionsSent = 0, coursesRestored = 0, missionsRestored = 0, missionsRefused = 0, missionsWaiting = 0;
    final notSaved = <String>[];

    // Server enrollments by course id (track|source), active ones only.
    var me = await api.me();
    final server = <String, String>{};
    for (final e in (me['enrollments'] as List? ?? const [])) {
      if (e is! Map || e['status'] != 'active') continue;
      server[courseIdFor('${e['courseTrackId']}', '${e['sourceLanguageCode']}')] = '${e['id']}';
    }

    // 1. Courses of the account this device can teach, added here once their chapters are read (one that cannot be
    // read now is added by a later sync).
    for (final courseId in server.keys) {
      final (trackId, source) = _split(courseId);
      if (!target.current.content.isAvailable(trackId, source) || target.current.learner.isEnrolled(trackId, source)) continue;
      if (!await _loaded(trackId)) continue;
      target.restoreEnrollment(trackId, source);
      coursesRestored++;
    }

    // 2. Courses of this device, created in the account.
    for (final enrollment in target.current.learner.enrollments) {
      if (server.containsKey(enrollment.courseId)) continue;
      try {
        final created = await api.createEnrollment(enrollment.trackId, enrollment.source);
        server[enrollment.courseId] = '${created['id']}';
        coursesSent++;
      } on ApiException catch (e) {
        if (e.isTransient) rethrow;
        notSaved.add(enrollment.courseId);
      }
    }
    await ledger.markSent(user.id, [for (final id in server.keys) SyncLedger.enrollmentKey(id)]);
    // The capability snapshots of the courses just created come with the account's next read.
    if (coursesSent > 0) me = await api.me();

    for (final MapEntry(key: courseId, value: enrollmentId) in server.entries) {
      final (trackId, source) = _split(courseId);
      if (!target.current.learner.isEnrolled(trackId, source) || !await _loaded(trackId)) continue;
      final course = target.current.content.course(trackId, source);
      if (course == null) continue;
      final keyByServerId = {for (final m in course.missions) missionServerId(m.chapterKey, m.key): m.key};

      // 3. Missions completed in the account: their stops are done here too (no XP, no review cards).
      final done = await auth.completedMissionIds(enrollmentId);
      final progress = target.current.learner.progressOf(courseId);
      final restored = [
        for (final id in done)
          if (keyByServerId[id] case final key? when !progress.isMissionCompleted(key)) key,
      ];
      if (restored.isNotEmpty) {
        target.restoreCompletedMissions(courseId, restored);
        missionsRestored += restored.length;
      }
      await ledger.markSent(user.id, [
        for (final id in done)
          if (keyByServerId[id] case final key?) SyncLedger.missionKey(courseId, key),
      ]);

      // 4. Missions completed here, reported to the account.
      final alreadySent = ledger.sent(user.id);
      // Chapters the server does not have yet: asked about once per sync, not once per mission.
      final unknownChapters = <String>{};
      for (final mission in course.missions) {
        final ledgerKey = SyncLedger.missionKey(courseId, mission.key);
        if (alreadySent.contains(ledgerKey) || !target.current.learner.progressOf(courseId).isMissionCompleted(mission.key)) continue;
        if (unknownChapters.contains(mission.chapterKey)) {
          missionsWaiting++;
          continue;
        }
        try {
          await _reportMission(user, courseId, source, enrollmentId, mission);
          missionsSent++;
        } on ApiException catch (e) {
          if (e.isTransient) rethrow;
          // Not in the server's curriculum yet (a chapter newer than it): the completion stays on the device and
          // is reported once the server has the chapter. Anything else is refused for good.
          if (e.status == 404) {
            unknownChapters.add(mission.chapterKey);
            missionsWaiting++;
            continue;
          }
          missionsRefused++;
        }
        await ledger.markSent(user.id, [ledgerKey]);
      }
    }
    return SyncReport(
      coursesSent: coursesSent,
      missionsSent: missionsSent,
      coursesRestored: coursesRestored,
      missionsRestored: missionsRestored,
      coursesNotSaved: notSaved,
      missionsRefused: missionsRefused,
      missionsWaiting: missionsWaiting,
      courses: serverCourses(me),
      keepsRecordings: accountKeepsRecordings(me),
    );
  }

  /// Whether [trackId]'s chapters are in memory, reading them if needed; a course that cannot be read is skipped.
  Future<bool> _loaded(String trackId) async {
    try {
      await target.loadCourse(trackId);
      return target.current.content.isLoaded(trackId);
    } catch (e) {
      debugPrint('sync: the chapters of $trackId could not be read: $e');
      return false;
    }
  }

  /// The account's active courses (from `GET /v1/me`) by course id.
  static Map<String, ServerCourse> serverCourses(Map<String, Object?> me) => {
    for (final e in (me['enrollments'] as List? ?? const []))
      if (ServerCourse.fromEnrollment(e) case final course? when e is Map) courseIdFor('${e['courseTrackId']}', '${e['sourceLanguageCode']}'): course,
  };

  Future<void> _reportMission(AccountUser user, String courseId, String source, String enrollmentId, Mission mission) async {
    final missionId = missionServerId(mission.chapterKey, mission.key);
    final detail = await api.missionDetail(missionId, source: source, enrollmentId: enrollmentId);
    final times = ledger.missionTimes(courseId, mission.key);
    final completedAt = times.completedAt ?? _now().toUtc();
    final startedAt = times.openedAt != null && times.openedAt!.isBefore(completedAt) ? times.openedAt! : completedAt;
    // Deterministic ids: a repeated sync replays the same attempt and evaluation instead of creating new ones.
    final ref = '${user.id}:$courseId:${mission.key}';
    final attemptId = await api.startAttempt(
      missionId,
      enrollmentId: enrollmentId,
      clientAttemptId: uuidV5(curriculumNamespace, 'langquest.flutter:attempt:$ref'),
      missionRevision: (detail['revision'] as num?)?.toInt() ?? 1,
      startedAt: startedAt,
    );
    // The learner produced every one of their lines (the mission completes only then); steps built on anything else
    // (listening, recall, free conversation) are not something this app checked: `unclear`, never a made-up result.
    final produced = {
      for (final e in mission.expressions)
        if (e.byLearner) expressionServerId(e.id),
    };
    final steps = [for (final s in (detail['steps'] as List? ?? const [])) (s as Map).cast<String, Object?>()];
    final perStepMs = steps.isEmpty ? 0 : completedAt.difference(startedAt).inMilliseconds ~/ steps.length;
    await api.evaluate(
      missionId,
      attemptId: attemptId,
      enrollmentId: enrollmentId,
      completedAt: completedAt,
      clientEventId: uuidV5(curriculumNamespace, 'langquest.flutter:evaluate:$ref'),
      stepResults: [
        for (final step in steps)
          {
            'stepId': step['id'],
            'outcome': (step['expressions'] as List? ?? const []).any((e) => e is Map && produced.contains(e['id'])) ? 'success' : 'unclear',
            'hintsUsed': times.firstTry ? 0 : 1,
            'replays': 0,
            'durationMs': perStepMs,
            'speechAssessmentIds': const <String>[],
            'attemptedBeforeReveal': true,
            'selectedIntentId': null,
            'conversationSessionId': null,
          },
      ],
    );
  }

  static (String, String) _split(String courseId) {
    final i = courseId.indexOf('|');
    return (courseId.substring(0, i), courseId.substring(i + 1));
  }
}
