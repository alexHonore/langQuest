/// The learner's own data, kept on the device (no account or backend in this build): enrollments, progress per
/// course, review schedules and XP. Pure Dart with a versioned JSON form (`LearnerStore` persists it).
library;

import '../../features/learn/learn_logic.dart';
import '../content/content_bundle.dart';
import '../content/content_models.dart';
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

enum LessonActivity { scene, cards, practise, mission }

/// An activity's next step and the results already committed at earlier step boundaries.
class LessonCheckpoint {
  const LessonCheckpoint(this.activity, this.stepId, {this.completedSteps = const [], this.firstTry = const {}, this.spoken = const {}});

  final LessonActivity activity;
  final String stepId;
  final List<String> completedSteps;
  final Map<String, bool> firstTry;
  final Map<String, bool> spoken;

  PathStop get stop => switch (activity) {
    LessonActivity.scene || LessonActivity.cards => PathStop.learn,
    LessonActivity.practise => PathStop.practise,
    LessonActivity.mission => PathStop.mission,
  };

  Map<String, Object?> toJson() => {
    'activity': activity.name,
    'stepId': stepId,
    if (completedSteps.isNotEmpty) 'completedSteps': completedSteps,
    if (firstTry.isNotEmpty) 'firstTry': firstTry,
    if (spoken.isNotEmpty) 'spoken': spoken,
  };

  static LessonCheckpoint? fromJson(Object? raw) {
    if (raw is! Map || raw['stepId'] is! String) return null;
    final activity = LessonActivity.values.where((value) => value.name == raw['activity']).firstOrNull;
    if (activity == null) return null;
    Map<String, bool> results(Object? json) => json is Map
        ? {
            for (final entry in json.entries)
              if (entry.key is String && entry.value is bool) entry.key as String: entry.value as bool,
          }
        : const {};
    return LessonCheckpoint(
      activity,
      raw['stepId'] as String,
      completedSteps: raw['completedSteps'] is List ? (raw['completedSteps'] as List).whereType<String>().toList() : const [],
      firstTry: results(raw['firstTry']),
      spoken: results(raw['spoken']),
    );
  }
}

/// Progress inside one course (one enrollment).
class CourseProgress {
  /// Learn-path stops done, per mission key.
  final Map<String, Set<PathStop>> stops;

  /// Review schedule per expression id (created when the learner first uses a phrase in its mission).
  final Map<String, ReviewCard> cards;

  final Map<String, LessonCheckpoint> checkpoints;

  /// The learner chose to finish these missions without recording.
  final Set<String> quietMissions;

  const CourseProgress({this.stops = const {}, this.cards = const {}, this.checkpoints = const {}, this.quietMissions = const {}});

  Set<PathStop> stopsDone(String missionKey) => stops[missionKey] ?? const {};
  bool isMissionCompleted(String missionKey) => stopsDone(missionKey).contains(PathStop.mission);

  LessonCheckpoint? checkpoint(String missionKey, PathStop stop) => checkpoints[_checkpointKey(missionKey, stop)];
  LessonCheckpoint? latestCheckpoint(String missionKey, List<PathStop> stops) =>
      checkpoints.entries.where((entry) => stops.contains(entry.value.stop) && entry.key == _checkpointKey(missionKey, entry.value.stop)).lastOrNull?.value;

  static String _checkpointKey(String missionKey, PathStop stop) => '$missionKey/${stop.name}';

  CourseProgress withStop(String missionKey, PathStop stop) => _copyWith(
    stops: {
      ...stops,
      missionKey: {...stopsDone(missionKey), stop},
    },
    checkpoints: {...checkpoints}..remove(_checkpointKey(missionKey, stop)),
    quietMissions: stop == PathStop.mission ? ({...quietMissions}..remove(missionKey)) : quietMissions,
  );
  CourseProgress withCards(Map<String, ReviewCard> updated) => _copyWith(cards: {...cards, ...updated});
  CourseProgress withCheckpoint(String missionKey, LessonCheckpoint checkpoint) {
    final key = _checkpointKey(missionKey, checkpoint.stop);
    return _copyWith(
      checkpoints: {...checkpoints}
        ..remove(key)
        ..[key] = checkpoint,
    );
  }

  CourseProgress withQuietMission(String missionKey, bool quiet) =>
      _copyWith(quietMissions: quiet ? {...quietMissions, missionKey} : ({...quietMissions}..remove(missionKey)));

  CourseProgress _copyWith({
    Map<String, Set<PathStop>>? stops,
    Map<String, ReviewCard>? cards,
    Map<String, LessonCheckpoint>? checkpoints,
    Set<String>? quietMissions,
  }) => CourseProgress(
    stops: stops ?? this.stops,
    cards: cards ?? this.cards,
    checkpoints: checkpoints ?? this.checkpoints,
    quietMissions: quietMissions ?? this.quietMissions,
  );

  Map<String, Object?> toJson() => {
    'stops': {
      for (final e in stops.entries) e.key: [for (final s in e.value) s.name],
    },
    'cards': {for (final e in cards.entries) e.key: e.value.toJson()},
    if (checkpoints.isNotEmpty) 'checkpoints': {for (final e in checkpoints.entries) e.key: e.value.toJson()},
    if (quietMissions.isNotEmpty) 'quietMissions': quietMissions.toList(),
  };

  static CourseProgress fromJson(Object? raw) {
    if (raw is! Map) return const CourseProgress();
    final stopsRaw = raw['stops'];
    final cardsRaw = raw['cards'];
    final checkpointRaw = raw['checkpoints'];
    final quietRaw = raw['quietMissions'];
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
      checkpoints: {
        if (checkpointRaw is Map)
          for (final e in checkpointRaw.entries) '${e.key}': ?LessonCheckpoint.fromJson(e.value),
      },
      quietMissions: quietRaw is List ? quietRaw.whereType<String>().toSet() : const {},
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

  /// Exercises are read aloud as they appear: the context and the question in the instruction language, then the
  /// phrase in the course's voice.
  final bool readAloud;
  final bool latinOnly;
  final SpeakerForm speakerForm;
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
    this.readAloud = true,
    this.latinOnly = false,
    this.speakerForm = SpeakerForm.course,
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
    return enrollmentsInInstructionOrder.firstOrNull;
  }

  Iterable<Enrollment> get enrollmentsInInstructionOrder sync* {
    yield* enrollments.where((course) => course.source == preferredInstructionLanguage);
    yield* enrollments.where((course) => course.source != preferredInstructionLanguage);
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
    bool? readAloud,
    bool? latinOnly,
    SpeakerForm? speakerForm,
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
    readAloud: readAloud ?? this.readAloud,
    latinOnly: latinOnly ?? this.latinOnly,
    speakerForm: speakerForm ?? this.speakerForm,
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
    'readAloud': readAloud,
    'latinOnly': latinOnly,
    'speakerForm': speakerForm.name,
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
      readAloud: raw['readAloud'] != false,
      latinOnly: raw['latinOnly'] == true,
      speakerForm: SpeakerForm.values.where((form) => form.name == raw['speakerForm']).firstOrNull ?? SpeakerForm.course,
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
