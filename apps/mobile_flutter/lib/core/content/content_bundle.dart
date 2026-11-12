import 'dart:convert';

import 'package:flutter/foundation.dart' show debugPrint;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'bundled_voices.dart';
import 'content_models.dart';
import 'real_examples.dart';

/// A course as the learner takes it: one track taught from one instruction language (CONVENTIONS §2.2). Its content
/// is the bundle's draft chapters of that track that carry overlays for that language.
class Course {
  final CourseTrackInfo track;
  final String source;
  final List<Chapter> chapters;

  const Course({required this.track, required this.source, required this.chapters});

  String get id => courseIdFor(track.id, source);
  List<Mission> get missions => [for (final c in chapters) ...c.missions];
  bool get hasContent => missions.isNotEmpty;

  /// Every bundled chapter is an unreviewed AI draft; disclosed before enrolling and on the pathway.
  bool get isDraft => chapters.any((c) => !c.nativeReviewed);

  int indexOfMission(String missionKey) => missions.indexWhere((m) => m.key == missionKey);

  Set<String> get characterKeys => {for (final m in missions) m.characterKey};
}

String courseIdFor(String trackId, String source) => '$trackId|$source';

/// Reads a bundle file by its asset path (`rootBundle.loadString` in the app, the package's files in tests).
typedef ContentReader = Future<String> Function(String assetPath);

/// The offline content bundle: the 30-track catalog (with the instruction languages each course is taught from), the
/// names of the skills the server tracks, the cast's roles, the real examples and bundled voices, and the draft
/// chapters of the courses loaded so far.
///
/// Each course's chapters are a file of their own (`assets/content/chapters/<trackId>.json`): start-up reads only the
/// learner's courses ([load]), and a course is read when the learner opens or takes it ([ContentNotifier.loadCourse]).
/// What a course offers before that (instruction languages, mission count) is in the catalog.
class ContentBundle {
  final List<CourseTrackInfo> tracks;

  /// The chapters of the courses read so far ([isLoaded]), each course's whole.
  final List<Chapter> chapters;
  final Map<String, SkillInfo> skills;

  /// The cast's roles by roster id, then by language (`cast.json`; the server's characters carry an English role).
  final Map<String, Map<String, String>> roles;

  /// Real examples from Tatoeba for the phrases (`examples.json`).
  final RealExamples examples;

  /// The lines read by natural AI voices, bundled (`voices.json`).
  final BundledVoices voices;
  final Map<String, CourseTrackInfo> _tracksById;
  final Set<String> _loadedTracks;
  final Map<String, Mission> _missionsByKey;
  final Map<String, Chapter> _chaptersByKey;

  /// [loadedTracks]: courses whose chapter file has been read, besides those [chapters] belong to.
  ContentBundle({
    required this.tracks,
    this.chapters = const [],
    Iterable<String> loadedTracks = const [],
    this.skills = const {},
    this.roles = const {},
    this.examples = RealExamples.empty,
    this.voices = BundledVoices.empty,
  }) : _tracksById = {for (final t in tracks) t.id: t},
       _loadedTracks = {...loadedTracks, for (final c in chapters) c.courseTrackId},
       _missionsByKey = {
         for (final c in chapters)
           for (final m in c.missions) m.key: m,
       },
       _chaptersByKey = {for (final c in chapters) c.key: c};

  static const catalogAsset = 'assets/content/catalog.json';
  static const skillsAsset = 'assets/content/skills.json';
  static const castAsset = 'assets/content/cast.json';
  static const examplesAsset = 'assets/content/examples.json';
  static const voicesAsset = 'assets/content/voices.json';

  /// The asset holding [trackId]'s chapters.
  static String chaptersAsset(String trackId) => 'assets/content/chapters/$trackId.json';

  /// Parse the bundle files ([coursesJson]: course chapter files, any number); throws [FormatException] on an
  /// unsupported schema version.
  factory ContentBundle.parse({
    required String catalogJson,
    Iterable<String> coursesJson = const [],
    String? skillsJson,
    String? castJson,
    String? examplesJson,
    String? voicesJson,
  }) {
    final catalog = _document(catalogJson);
    final skills = skillsJson == null ? null : _document(skillsJson);
    final cast = castJson == null ? null : _document(castJson);
    final tracks = [for (final t in (catalog['tracks'] as List? ?? const [])) CourseTrackInfo.fromJson((t as Map).cast<String, Object?>())]
      ..sort((a, b) => a.order.compareTo(b.order));
    final courses = [for (final json in coursesJson) parseCourse(json)];
    return ContentBundle(
      tracks: tracks,
      chapters: [for (final c in courses) ...c.chapters],
      loadedTracks: [for (final c in courses) c.trackId],
      skills: {
        for (final s in [
          for (final e in (skills?['skills'] as List? ?? const []))
            if (e is Map) SkillInfo.fromJson(e.cast<String, Object?>()),
        ])
          s.key: s,
      },
      roles: {
        for (final e in ((cast?['roles'] as Map?) ?? const {}).entries)
          if (e.value is Map) '${e.key}': {for (final r in (e.value as Map).entries) '${r.key}': '${r.value}'},
      },
      examples: examplesJson == null ? RealExamples.empty : RealExamples.parse(examplesJson),
      voices: voicesJson == null ? BundledVoices.empty : BundledVoices.parse(voicesJson),
    );
  }

  /// One course's chapter file (`chapters/<trackId>.json`); throws [FormatException] on an unsupported schema version
  /// or a chapter of another course.
  static ({String trackId, List<Chapter> chapters}) parseCourse(String json) {
    final doc = _document(json);
    final trackId = '${doc['courseTrackId']}';
    final chapters = [for (final c in (doc['chapters'] as List? ?? const [])) Chapter.fromJson((c as Map).cast<String, Object?>())];
    for (final c in chapters) {
      if (c.courseTrackId != trackId) throw FormatException('Chapter ${c.key} of ${c.courseTrackId} in the $trackId chapter file');
    }
    return (trackId: trackId, chapters: chapters);
  }

  static Map<String, Object?> _document(String json) {
    final doc = (jsonDecode(json) as Map).cast<String, Object?>();
    if (doc['schemaVersion'] != 1) throw FormatException('Unsupported content bundle schemaVersion ${doc['schemaVersion']}');
    return doc;
  }

  /// The catalog and what every course shares, plus the chapters of [courses] (the learner's, at start-up). A course
  /// whose file cannot be read is left out (logged), to be read again when it is opened; a malformed file throws.
  static Future<ContentBundle> load(ContentReader read, {Iterable<String> courses = const []}) async {
    final files = await Future.wait([catalogAsset, skillsAsset, castAsset, examplesAsset, voicesAsset].map(read));
    var bundle = ContentBundle.parse(catalogJson: files[0], skillsJson: files[1], castJson: files[2], examplesJson: files[3], voicesJson: files[4]);
    Future<String?> readCourse(String trackId) async {
      try {
        return await read(chaptersAsset(trackId));
      } catch (e) {
        debugPrint('Course $trackId not loaded at start-up: $e');
        return null;
      }
    }

    final wanted = {
      for (final id in courses)
        if (bundle.track(id) != null && !bundle.isLoaded(id)) id,
    };
    for (final json in (await Future.wait(wanted.map(readCourse))).nonNulls) {
      final course = parseCourse(json);
      bundle = bundle.withCourse(course.trackId, course.chapters);
    }
    return bundle;
  }

  /// This bundle with [trackId]'s chapters (replacing any read before).
  ContentBundle withCourse(String trackId, List<Chapter> courseChapters) => ContentBundle(
    tracks: tracks,
    chapters: [
      for (final c in chapters)
        if (c.courseTrackId != trackId) c,
      ...courseChapters,
    ],
    loadedTracks: {..._loadedTracks, trackId},
    skills: skills,
    roles: roles,
    examples: examples,
    voices: voices,
  );

  /// Whether [trackId]'s chapters are in memory, or it has none to read (a planned course). False for an unknown track.
  bool isLoaded(String trackId) {
    final t = _tracksById[trackId];
    return t != null && (t.sources.isEmpty || _loadedTracks.contains(trackId));
  }

  /// A roster character's role in [language], when the bundle translates it.
  String? roleOf(String rosterId, String language) => roles[rosterId]?[language];

  /// The skill's names, or null for a key this bundle does not know (a newer server).
  SkillInfo? skill(String key) => skills[key];

  CourseTrackInfo? track(String id) => _tracksById[id];

  /// A mission of a loaded course ([isLoaded]).
  Mission? mission(String key) => _missionsByKey[key];
  Chapter? chapter(String key) => _chaptersByKey[key];
  Chapter? chapterOf(Mission mission) => _chaptersByKey[mission.chapterKey];

  StoryCharacter? characterOf(Mission mission) => chapterOf(mission)?.character(mission.characterKey);

  /// The course for (track, source), or null when the track is unknown or its chapters are not loaded yet
  /// ([ContentNotifier.loadCourse]). Its chapters may be empty (planned course).
  Course? course(String trackId, String source) {
    final t = _tracksById[trackId];
    if (t == null || !isLoaded(trackId)) return null;
    return Course(
      track: t,
      source: source,
      chapters: [
        for (final c in chapters)
          if (c.courseTrackId == trackId && c.sourceLanguages.contains(source)) c,
      ],
    );
  }

  /// Instruction languages (among the interface's) a track can be learned from today (the catalog's, no chapters read).
  List<String> sourcesFor(String trackId) {
    final sources = _tracksById[trackId]?.sources ?? const [];
    return [
      for (final s in supportedInstructionLanguages)
        if (sources.contains(s)) s,
    ];
  }

  bool isAvailable(String trackId, String source) => sourcesFor(trackId).contains(source);

  /// Tracks with content from [source], in catalog order.
  List<CourseTrackInfo> availableFrom(String source) => [
    for (final t in tracks)
      if (isAvailable(t.id, source)) t,
  ];
}

/// The bundle as loaded so far. [loadCourse] adds a course's chapters; everything that watches the bundle then sees
/// them (the learn plans, missions, review, calls…).
class ContentNotifier extends Notifier<ContentBundle> {
  ContentNotifier(this._initial, {this.read});

  final ContentBundle _initial;

  /// Reads a course's chapter file (none: only the courses of the initial bundle exist).
  final ContentReader? read;
  final _pending = <String, Future<void>>{};

  @override
  ContentBundle build() => _initial;

  /// Reads [trackId]'s chapters unless they are in memory; concurrent calls share one read, and a failed read is tried
  /// again on the next call.
  Future<void> loadCourse(String trackId) {
    if (state.isLoaded(trackId)) return Future.value();
    if (state.track(trackId) == null) return Future.error(ArgumentError.value(trackId, 'trackId', 'unknown course'));
    final read = this.read;
    if (read == null) return Future.error(StateError('No reader for the chapters of $trackId'));
    // A block body: `remove` returns this very future, which `whenComplete` would then wait on.
    return _pending[trackId] ??= _load(read, trackId).whenComplete(() {
      _pending.remove(trackId);
    });
  }

  Future<void> _load(ContentReader read, String trackId) async {
    final course = ContentBundle.parseCourse(await read(ContentBundle.chaptersAsset(trackId)));
    if (course.trackId != trackId) throw FormatException('${ContentBundle.chaptersAsset(trackId)} holds the chapters of ${course.trackId}');
    if (ref.mounted && !state.isLoaded(trackId)) state = state.withCourse(trackId, course.chapters);
  }
}

/// Overridden in `main()` with the bundle loaded from the app's assets (and in tests with a parsed one).
final contentBundleProvider = NotifierProvider<ContentNotifier, ContentBundle>(() => throw UnimplementedError('contentBundleProvider must be overridden'));

/// [trackId]'s chapters, read when a screen starts watching (see [ContentNotifier.loadCourse]); for screens that show a
/// course while it loads. A failed read is tried again when the course is shown again, or on invalidation.
final courseContentProvider = FutureProvider.autoDispose.family<void, String>(
  (ref, trackId) => ref.read(contentBundleProvider.notifier).loadCourse(trackId),
  retry: (_, _) => null,
);
