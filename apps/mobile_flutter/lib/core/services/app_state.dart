import 'dart:ui' show PlatformDispatcher;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/learn/learn_logic.dart';
import '../backend/account.dart';
import '../backend/sync_service.dart';
import '../content/content_bundle.dart';
import '../content/content_models.dart';
import '../learning/srs.dart';
import '../theme/accents.dart';
import '../theme/colors.dart';
import 'learner_state.dart';
import 'learner_store.dart';

/// Clock used for schedules, streaks and XP days (overridden in tests).
final clockProvider = Provider<DateTime Function()>((ref) => DateTime.now);

/// Language of the device, used until the learner picks one (overridden in tests).
final deviceLanguageProvider = Provider<String>((ref) => PlatformDispatcher.instance.locale.languageCode);

/// Most reviews offered in one sitting, so new material is never crowded out (`maxReviewsPerSession`).
const maxReviewsPerSession = 12;

/// Everything the screens read: the learner's saved state plus the content bundle it refers to.
class AppState {
  final ContentBundle content;
  final LearnerState learner;
  final String deviceLanguage;

  const AppState({required this.content, required this.learner, required this.deviceLanguage});

  /// Interface language: the learner's choice, else the device language when supported, else English.
  String get uiLanguage {
    final chosen = learner.uiLanguage;
    if (chosen != null && supportedInstructionLanguages.contains(chosen)) return chosen;
    return supportedInstructionLanguages.contains(deviceLanguage) ? deviceLanguage : 'en';
  }

  bool get isDark => learner.darkMode;
  LangQuestColors get colors => isDark ? LangQuestColors.dark : LangQuestColors.light;

  bool get hasEnrollment => learner.enrollments.isNotEmpty;

  /// The course being learned (null before the first enrollment).
  Course? get activeCourse {
    final e = learner.activeEnrollment;
    return e == null ? null : content.course(e.trackId, e.source);
  }

  String? get activeTrackId => activeCourse?.track.id;
  CourseAccent get accent => CourseAccent.forTrack(activeCourse?.track, isDark: isDark);

  CourseProgress get progress {
    final course = activeCourse;
    return course == null ? const CourseProgress() : learner.progressOf(course.id);
  }

  Set<PathStop> stopsDone(String missionKey) => progress.stopsDone(missionKey);

  /// A mission opens once the one before it is completed (the first is always open).
  bool isUnlocked(Course course, String missionKey) {
    final i = course.indexOfMission(missionKey);
    if (i <= 0) return i == 0;
    return learner.progressOf(course.id).isMissionCompleted(course.missions[i - 1].key);
  }

  /// The first mission of the course not completed yet; null when the whole course is done.
  Mission? nextMission(Course course) {
    final p = learner.progressOf(course.id);
    for (final m in course.missions) {
      if (!p.isMissionCompleted(m.key)) return m;
    }
    return null;
  }

  /// Due review cards of the active course, most fragile first, capped per session.
  List<ReviewCard> dueCards(DateTime now, {Scheduler scheduler = const Scheduler()}) {
    final due = [
      for (final c in progress.cards.values)
        if (c.isDue(now)) c,
    ]..sort((a, b) => scheduler.retrievabilityAt(a, now).compareTo(scheduler.retrievabilityAt(b, now)));
    return due.take(maxReviewsPerSession).toList();
  }

  int streak(DateTime now) => streakDays(learner.xpByDay, now);
}

class AppStateNotifier extends Notifier<AppState> implements RestoreTarget {
  static const _scheduler = Scheduler();

  @override
  AppState build() {
    // A course's chapters arriving (opened, taken or restored) changes the content only; the learner stays as is.
    ref.listen(contentBundleProvider, (_, content) => state = AppState(content: content, learner: state.learner, deviceLanguage: state.deviceLanguage));
    return AppState(
      content: ref.read(contentBundleProvider),
      learner: ref.read(learnerStoreProvider).load(),
      deviceLanguage: ref.watch(deviceLanguageProvider),
    );
  }

  DateTime get _now => ref.read(clockProvider)();

  void _update(LearnerState learner) {
    state = AppState(content: state.content, learner: learner, deviceLanguage: state.deviceLanguage);
    ref.read(learnerStoreProvider).save(learner);
  }

  void setUiLanguage(String code) {
    if (!supportedInstructionLanguages.contains(code)) return;
    _update(state.learner.copyWith(uiLanguage: code));
  }

  void setDarkMode(bool dark) => _update(state.learner.copyWith(darkMode: dark, followDeviceTheme: false));
  void toggleTheme() => setDarkMode(!state.isDark);

  /// Follow the device's light/dark setting from now on, starting with its current one ([deviceDark]).
  void followDeviceTheme(bool deviceDark) => _update(state.learner.copyWith(followDeviceTheme: true, darkMode: deviceDark));

  /// The device switched between light and dark: mirrored only while the learner follows the device.
  void deviceThemeChanged(bool deviceDark) {
    final learner = state.learner;
    if (learner.followDeviceTheme && learner.darkMode != deviceDark) _update(learner.copyWith(darkMode: deviceDark));
  }

  void setTextScale(double scale) => _update(state.learner.copyWith(textScale: nearestTextScale(scale)));
  void setReduceMotion(bool reduce) => _update(state.learner.copyWith(reduceMotion: reduce));
  void setMascot(bool shown) => _update(state.learner.copyWith(mascot: shown));
  void setReadAloud(bool on) => _update(state.learner.copyWith(readAloud: on));

  /// Enroll in (track, source) — only when the bundle has content for that pair — and make it the active course. Its
  /// chapters are read now if they were not yet (the course screen reads them before offering to start); until then
  /// [AppState.activeCourse] is null, and a failed read is shown and tried again by `ActiveCourseGate`.
  bool enroll(String trackId, String source) {
    if (!state.content.isAvailable(trackId, source)) return false;
    final learner = state.learner;
    final id = courseIdFor(trackId, source);
    final enrollments = learner.isEnrolled(trackId, source)
        ? learner.enrollments
        : [...learner.enrollments, Enrollment(trackId: trackId, source: source, enrolledAt: _now.toUtc())];
    _update(learner.copyWith(enrollments: enrollments, activeCourseId: id));
    loadCourse(trackId).ignore();
    _accountChanged();
    return true;
  }

  /// Reads [trackId]'s chapters unless they are in memory ([ContentNotifier.loadCourse]).
  @override
  Future<void> loadCourse(String trackId) => ref.read(contentBundleProvider.notifier).loadCourse(trackId);

  // ── Account sync (RestoreTarget) ─────────────────────────────────────────────────────────────────────────────

  @override
  AppState get current => state;

  /// A course of the learner's account, added on this device; it becomes active only when none is.
  @override
  void restoreEnrollment(String trackId, String source) {
    final learner = state.learner;
    if (!state.content.isAvailable(trackId, source) || learner.isEnrolled(trackId, source)) return;
    _update(
      learner.copyWith(
        enrollments: [
          ...learner.enrollments,
          Enrollment(trackId: trackId, source: source, enrolledAt: _now.toUtc()),
        ],
        activeCourseId: learner.activeCourseId ?? courseIdFor(trackId, source),
      ),
    );
  }

  /// Missions completed with this account elsewhere: every stop marked done so the path unlocks — no XP and no
  /// review cards (those stay with the device that earned them).
  @override
  void restoreCompletedMissions(String courseId, Iterable<String> missionKeys) {
    var progress = state.learner.progressOf(courseId);
    for (final key in missionKeys) {
      for (final stop in const [PathStop.learn, PathStop.practise, PathStop.play, PathStop.mission]) {
        progress = progress.withStop(key, stop);
      }
    }
    _update(state.learner.withCourse(courseId, progress));
  }

  /// When the mission stop opened (sent with its completion, so the server sees a real attempt window).
  void missionOpened(String missionKey) {
    final course = state.activeCourse;
    if (course != null) ref.read(syncLedgerProvider).missionOpened(course.id, missionKey, _now);
  }

  void _accountChanged() => ref.read(accountProvider.notifier).scheduleSync();

  void switchCourse(String courseId) {
    if (!state.learner.enrollments.any((e) => e.courseId == courseId)) return;
    _update(state.learner.copyWith(activeCourseId: courseId));
  }

  /// Remove one course and its progress (other courses and XP history stay).
  void unenroll(String courseId) {
    final learner = state.learner;
    final enrollments = [
      for (final e in learner.enrollments)
        if (e.courseId != courseId) e,
    ];
    final courses = {...learner.courses}..remove(courseId);
    final active = learner.activeCourseId == courseId ? (enrollments.isEmpty ? null : enrollments.first.courseId) : learner.activeCourseId;
    _update(learner.copyWith(enrollments: enrollments, courses: courses, activeCourseId: active));
  }

  /// Mark a Learn, Practise or Play stop of [missionKey] done in the active course (+5 XP the first time).
  void completeStop(String missionKey, PathStop stop) {
    final course = state.activeCourse;
    if (course == null || course.indexOfMission(missionKey) < 0) return;
    final progress = state.learner.progressOf(course.id);
    if (progress.stopsDone(missionKey).contains(stop)) return;
    _update(state.learner.withCourse(course.id, progress.withStop(missionKey, stop)).withXp(XpAmounts.stepCompleted, _now));
  }

  /// The Mission stop is done: +50 XP the first time, and each phrase the learner used enters spaced review with
  /// the rating its exchange earned (first-try right = good, otherwise hard). Existing schedules are left as they are.
  void completeMission(String missionKey, Map<String, ReviewRating> ratingsByExpressionId) {
    final course = state.activeCourse;
    if (course == null || course.indexOfMission(missionKey) < 0) return;
    final now = _now.toUtc();
    final progress = state.learner.progressOf(course.id);
    final firstTime = !progress.isMissionCompleted(missionKey);
    final newCards = <String, ReviewCard>{
      for (final e in ratingsByExpressionId.entries)
        if (!progress.cards.containsKey(e.key)) e.key: _scheduler.review(ReviewCard.fresh(e.key, now), e.value, now).card,
    };
    var learner = state.learner.withCourse(course.id, progress.withStop(missionKey, PathStop.mission).withCards(newCards));
    if (firstTime) learner = learner.withXp(XpAmounts.missionCompleted, now);
    _update(learner);
    if (firstTime) {
      ref
          .read(syncLedgerProvider)
          .missionCompleted(course.id, missionKey, now, firstTryEverywhere: ratingsByExpressionId.values.every((r) => r == ReviewRating.good));
      _accountChanged();
    }
  }

  /// XP the server awarded for something done on this device (a live call's evaluation), so the learner's total
  /// shows what the call summary said.
  void addServerXp(int amount) {
    if (amount <= 0) return;
    _update(state.learner.withXp(amount, _now));
  }

  /// A mini-game round played to the end: practice, paid like a step (+5 XP; `GameStats` calls this once a day per
  /// game).
  void gameRoundPlayed() => _update(state.learner.withXp(XpAmounts.stepCompleted, _now));

  /// Rate one due card (+3 XP).
  void reviewCard(String expressionId, ReviewRating rating) {
    final course = state.activeCourse;
    if (course == null) return;
    final progress = state.learner.progressOf(course.id);
    final card = progress.cards[expressionId];
    if (card == null) return;
    final now = _now.toUtc();
    final next = _scheduler.review(card, rating, now).card;
    _update(state.learner.withCourse(course.id, progress.withCards({expressionId: next})).withXp(XpAmounts.reviewCompleted, now));
  }

  /// Settings › reset: forgets the courses and progress on this device; the interface and display choices stay.
  void resetAll() {
    final l = state.learner;
    _update(
      LearnerState(
        uiLanguage: l.uiLanguage,
        darkMode: l.darkMode,
        followDeviceTheme: l.followDeviceTheme,
        textScale: l.textScale,
        reduceMotion: l.reduceMotion,
        mascot: l.mascot,
        readAloud: l.readAloud,
      ),
    );
  }
}

final appStateProvider = NotifierProvider<AppStateNotifier, AppState>(AppStateNotifier.new);
