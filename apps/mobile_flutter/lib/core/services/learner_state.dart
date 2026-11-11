/// The learner's own data, kept on the device (no account or backend in this build): enrollments, progress per
/// course, review schedules and XP. Pure Dart with a versioned JSON form (`LearnerStore` persists it).
library;

import '../../features/learn/learn_logic.dart';
import '../content/content_bundle.dart';
import '../learning/srs.dart';

/// XP per outcome, from `@langquest/contracts` `XP_AMOUNTS` (XP measures practice, never proficiency).
abstract final class XpAmounts {
  static const missionCompleted = 50;
  static const stepCompleted = 5;
  static const reviewCompleted = 3;
}

/// Local calendar day key, `yyyy-MM-dd`.
String dayKey(DateTime t) {
  final local = t.toLocal();
  return '${local.year.toString().padLeft(4, '0')}-${local.month.toString().padLeft(2, '0')}-${local.day.toString().padLeft(2, '0')}';
}

class Enrollment {
  final String trackId;

  /// Instruction language the course is taught from (meanings and notes are shown in it).
  final String source;
  final DateTime enrolledAt;

  const Enrollment({required this.trackId, required this.source, required this.enrolledAt});

  String get courseId => courseIdFor(trackId, source);

  Map<String, Object?> toJson() => {'trackId': trackId, 'source': source, 'enrolledAt': enrolledAt.toUtc().toIso8601String()};

  static Enrollment? fromJson(Object? raw) {
    if (raw is! Map || raw['trackId'] is! String || raw['source'] is! String) return null;
    return Enrollment(
      trackId: raw['trackId'] as String,
      source: raw['source'] as String,
      enrolledAt: DateTime.tryParse('${raw['enrolledAt']}') ?? DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
    );
  }
}

/// Progress inside one course (one enrollment).
class CourseProgress {
  /// Learn-path stops done, per mission key.
  final Map<String, Set<PathStop>> stops;

  /// Review schedule per expression id (created when the learner first uses a phrase in its mission).
  final Map<String, ReviewCard> cards;

  const CourseProgress({this.stops = const {}, this.cards = const {}});

  Set<PathStop> stopsDone(String missionKey) => stops[missionKey] ?? const {};
  bool isMissionCompleted(String missionKey) => stopsDone(missionKey).contains(PathStop.mission);

  CourseProgress withStop(String missionKey, PathStop stop) => CourseProgress(
    stops: {
      ...stops,
      missionKey: {...stopsDone(missionKey), stop},
    },
    cards: cards,
  );
  CourseProgress withCards(Map<String, ReviewCard> updated) => CourseProgress(stops: stops, cards: {...cards, ...updated});

  Map<String, Object?> toJson() => {
    'stops': {
      for (final e in stops.entries) e.key: [for (final s in e.value) s.name],
    },
    'cards': {for (final e in cards.entries) e.key: e.value.toJson()},
  };

  static CourseProgress fromJson(Object? raw) {
    if (raw is! Map) return const CourseProgress();
    final stopsRaw = raw['stops'];
    final cardsRaw = raw['cards'];
    return CourseProgress(
      stops: {
        if (stopsRaw is Map)
          for (final e in stopsRaw.entries)
            '${e.key}': {
              if (e.value is List)
                for (final name in e.value as List) ...PathStop.values.where((s) => s.name == name),
            },
      },
      cards: {
        if (cardsRaw is Map)
          for (final e in cardsRaw.entries) '${e.key}': ?ReviewCard.fromJson(e.value),
      },
    );
  }
}

/// The text sizes offered in Settings, as factors on top of the device's own text size (the Expo app's set).
const textScales = <double>[0.9, 1, 1.15, 1.3, 1.5, 1.8];

/// The offered text size closest to [scale] (a stored value from another version stays usable).
double nearestTextScale(double scale) => textScales.reduce((a, b) => (a - scale).abs() <= (b - scale).abs() ? a : b);

class LearnerState {
  static const schemaVersion = 1;

  /// Interface language chosen in settings (`en` | `fr`); null follows the device.
  final String? uiLanguage;

  /// Night Market is dark-first (approved U2); light is opt-in.
  final bool darkMode;

  /// Follow the device's light/dark setting ([darkMode] then mirrors it).
  final bool followDeviceTheme;

  /// Text size on top of the device's own, one of [textScales].
  final double textScale;

  /// Still screens: no scene or mascot motion, no slides or page transitions (on top of the device's setting).
  final bool reduceMotion;

  /// Melo, the mascot, is shown (it never carries information of its own).
  final bool mascot;
  final List<Enrollment> enrollments;
  final String? activeCourseId;
  final Map<String, CourseProgress> courses;
  final int xpTotal;

  /// XP earned per local day; a day with any XP is an active day (the streak is computed from these).
  final Map<String, int> xpByDay;

  const LearnerState({
    this.uiLanguage,
    this.darkMode = true,
    this.followDeviceTheme = false,
    this.textScale = 1,
    this.reduceMotion = false,
    this.mascot = true,
    this.enrollments = const [],
    this.activeCourseId,
    this.courses = const {},
    this.xpTotal = 0,
    this.xpByDay = const {},
  });

  Enrollment? get activeEnrollment {
    for (final e in enrollments) {
      if (e.courseId == activeCourseId) return e;
    }
    return enrollments.isEmpty ? null : enrollments.first;
  }

  CourseProgress progressOf(String courseId) => courses[courseId] ?? const CourseProgress();

  bool isEnrolled(String trackId, String source) => enrollments.any((e) => e.trackId == trackId && e.source == source);

  LearnerState copyWith({
    Object? uiLanguage = _keep,
    bool? darkMode,
    bool? followDeviceTheme,
    double? textScale,
    bool? reduceMotion,
    bool? mascot,
    List<Enrollment>? enrollments,
    Object? activeCourseId = _keep,
    Map<String, CourseProgress>? courses,
    int? xpTotal,
    Map<String, int>? xpByDay,
  }) => LearnerState(
    uiLanguage: identical(uiLanguage, _keep) ? this.uiLanguage : uiLanguage as String?,
    darkMode: darkMode ?? this.darkMode,
    followDeviceTheme: followDeviceTheme ?? this.followDeviceTheme,
    textScale: textScale ?? this.textScale,
    reduceMotion: reduceMotion ?? this.reduceMotion,
    mascot: mascot ?? this.mascot,
    enrollments: enrollments ?? this.enrollments,
    activeCourseId: identical(activeCourseId, _keep) ? this.activeCourseId : activeCourseId as String?,
    courses: courses ?? this.courses,
    xpTotal: xpTotal ?? this.xpTotal,
    xpByDay: xpByDay ?? this.xpByDay,
  );

  /// Add [amount] XP earned at [now] (also marks the day active).
  LearnerState withXp(int amount, DateTime now) {
    if (amount <= 0) return this;
    final day = dayKey(now);
    return copyWith(xpTotal: xpTotal + amount, xpByDay: {...xpByDay, day: (xpByDay[day] ?? 0) + amount});
  }

  LearnerState withCourse(String courseId, CourseProgress progress) => copyWith(courses: {...courses, courseId: progress});

  Map<String, Object?> toJson() => {
    'v': schemaVersion,
    'uiLanguage': uiLanguage,
    'darkMode': darkMode,
    'followDeviceTheme': followDeviceTheme,
    'textScale': textScale,
    'reduceMotion': reduceMotion,
    'mascot': mascot,
    'enrollments': [for (final e in enrollments) e.toJson()],
    'activeCourseId': activeCourseId,
    'courses': {for (final e in courses.entries) e.key: e.value.toJson()},
    'xpTotal': xpTotal,
    'xpByDay': xpByDay,
  };

  /// Parses stored state; unknown or damaged fields fall back to defaults instead of failing the app start.
  static LearnerState fromJson(Object? raw) {
    if (raw is! Map || raw['v'] != schemaVersion) return const LearnerState();
    final enrollments = [
      if (raw['enrollments'] is List)
        for (final e in raw['enrollments'] as List) ?Enrollment.fromJson(e),
    ];
    final coursesRaw = raw['courses'];
    final xpRaw = raw['xpByDay'];
    final ui = raw['uiLanguage'];
    final active = raw['activeCourseId'];
    return LearnerState(
      uiLanguage: ui is String ? ui : null,
      darkMode: raw['darkMode'] is bool ? raw['darkMode'] as bool : true,
      followDeviceTheme: raw['followDeviceTheme'] == true,
      textScale: nearestTextScale((raw['textScale'] as num?)?.toDouble() ?? 1),
      reduceMotion: raw['reduceMotion'] == true,
      mascot: raw['mascot'] != false,
      enrollments: enrollments,
      activeCourseId: active is String ? active : null,
      courses: {
        if (coursesRaw is Map)
          for (final e in coursesRaw.entries) '${e.key}': CourseProgress.fromJson(e.value),
      },
      xpTotal: (raw['xpTotal'] as num?)?.toInt() ?? 0,
      xpByDay: {
        if (xpRaw is Map)
          for (final e in xpRaw.entries)
            if (e.value is num) '${e.key}': (e.value as num).toInt(),
      },
    );
  }
}

const _keep = Object();

/// Consecutive active days ending today — or yesterday, so a streak is not lost before today's practice.
int streakDays(Map<String, int> xpByDay, DateTime now) {
  bool active(DateTime d) => (xpByDay[dayKey(d)] ?? 0) > 0;
  var day = DateTime(now.toLocal().year, now.toLocal().month, now.toLocal().day);
  if (!active(day)) day = day.subtract(const Duration(days: 1));
  var count = 0;
  while (active(day)) {
    count++;
    day = DateTime(day.year, day.month, day.day - 1);
  }
  return count;
}
