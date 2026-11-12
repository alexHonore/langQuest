import 'dart:convert';

import 'package:flutter/foundation.dart' show FlutterError;
import 'package:flutter/services.dart' show AssetBundle, rootBundle;
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

/// The offline content bundle: the 30-track catalog, the names of the skills the server tracks, and the draft chapters
/// of the courses loaded so far. Each course's chapters are a file of their own (`chapters/<track>.json`), loaded at
/// startup for the courses the learner is enrolled in and when another course is opened ([ContentLibrary.ensureTrack]);
/// what a course offers before that (its instruction languages, its mission count, draft or not) is in the catalog.
class ContentBundle {
  final List<CourseTrackInfo> tracks;
  final List<Chapter> chapters;
  final Map<String, SkillInfo> skills;

  /// The cast's roles by roster id, then by language (`cast.json`; the server's characters carry an English role).
  final Map<String, Map<String, String>> roles;

  /// Real examples from Tatoeba for the phrases (`examples.json`).
  final RealExamples examples;

  /// The lines read by natural AI voices, bundled (`voices.json`).
  final BundledVoices voices;
  final Map<String, CourseTrackInfo> _tracksById;
  final Map<String, Mission> _missionsByKey;
  final Map<String, Chapter> _chaptersByKey;

  ContentBundle({
    required this.tracks,
    required this.chapters,
    this.skills = const {},
    this.roles = const {},
    this.examples = RealExamples.empty,
    this.voices = BundledVoices.empty,
  }) : _tracksById = {for (final t in tracks) t.id: t},
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

  /// One course's chapters file.
  static String chaptersAssetOf(String trackId) => 'assets/content/chapters/$trackId.json';

  /// The chapters of a course's chapters file ([chaptersAssetOf]); throws [FormatException] on an unsupported schema.
  static List<Chapter> parseChapters(String json) {
    final doc = (jsonDecode(json) as Map).cast<String, Object?>();
    if (doc['schemaVersion'] != 1) throw FormatException('Unsupported content bundle schemaVersion ${doc['schemaVersion']}');
    return [for (final c in (doc['chapters'] as List? ?? const [])) Chapter.fromJson((c as Map).cast<String, Object?>())];
  }

  /// Parse the bundle files (the chapters of the courses in [chapterFiles] only); throws [FormatException] on an
  /// unsupported schema version.
  factory ContentBundle.parse({
    required String catalogJson,
    List<String> chapterFiles = const [],
    String? skillsJson,
    String? castJson,
    String? examplesJson,
    String? voicesJson,
  }) {
    final catalog = (jsonDecode(catalogJson) as Map).cast<String, Object?>();
    final skills = skillsJson == null ? null : (jsonDecode(skillsJson) as Map).cast<String, Object?>();
    final cast = castJson == null ? null : (jsonDecode(castJson) as Map).cast<String, Object?>();
    for (final doc in [catalog, ?skills, ?cast]) {
      if (doc['schemaVersion'] != 1) throw FormatException('Unsupported content bundle schemaVersion ${doc['schemaVersion']}');
    }
    final tracks = [for (final t in (catalog['tracks'] as List? ?? const [])) CourseTrackInfo.fromJson((t as Map).cast<String, Object?>())]
      ..sort((a, b) => a.order.compareTo(b.order));
    return ContentBundle(
      tracks: tracks,
      chapters: [for (final f in chapterFiles) ...parseChapters(f)],
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

  /// The bundle with the chapters of [tracks] (the learner's courses); the other courses load when opened.
  static Future<ContentBundle> load(AssetBundle assets, {Iterable<String> tracks = const []}) async {
    final files = await Future.wait([
      for (final t in {...tracks}) _loadOrNull(assets, chaptersAssetOf(t)),
    ]);
    return ContentBundle.parse(
      catalogJson: await assets.loadString(catalogAsset),
      chapterFiles: [for (final f in files) ?f],
      skillsJson: await assets.loadString(skillsAsset),
      castJson: await assets.loadString(castAsset),
      examplesJson: await assets.loadString(examplesAsset),
      voicesJson: await assets.loadString(voicesAsset),
    );
  }

  /// A course's chapters from the app's assets (none when the course has no chapters file).
  static Future<List<Chapter>> loadChapters(AssetBundle assets, String trackId) async {
    final json = await _loadOrNull(assets, chaptersAssetOf(trackId));
    return json == null ? const [] : parseChapters(json);
  }

  static Future<String?> _loadOrNull(AssetBundle assets, String key) async {
    try {
      return await assets.loadString(key);
    } on FlutterError {
      return null;
    }
  }

  /// This bundle with [more] chapters (a chapter already here is kept).
  ContentBundle withChapters(Iterable<Chapter> more) {
    final added = [
      for (final c in more)
        if (!_chaptersByKey.containsKey(c.key)) c,
    ];
    if (added.isEmpty) return this;
    return ContentBundle(tracks: tracks, chapters: [...chapters, ...added], skills: skills, roles: roles, examples: examples, voices: voices);
  }

  /// Whether [trackId]'s chapters are in this bundle.
  bool hasChaptersOf(String trackId) => chapters.any((c) => c.courseTrackId == trackId);

  /// The course's mission count from [source], before its chapters are loaded (the catalog's), or from its chapters.
  int missionCountOf(String trackId, String source) => _tracksById[trackId]?.missionCounts[source] ?? course(trackId, source)?.missions.length ?? 0;

  /// Whether the course is an unreviewed AI draft, before its chapters are loaded (the catalog's), or from its chapters.
  bool isDraftCourse(String trackId) => (_tracksById[trackId]?.draft ?? false) || chapters.any((c) => c.courseTrackId == trackId && !c.nativeReviewed);

  /// A roster character's role in [language], when the bundle translates it.
  String? roleOf(String rosterId, String language) => roles[rosterId]?[language];

  /// The skill's names, or null for a key this bundle does not know (a newer server).
  SkillInfo? skill(String key) => skills[key];

  CourseTrackInfo? track(String id) => _tracksById[id];
  Mission? mission(String key) => _missionsByKey[key];
  Chapter? chapter(String key) => _chaptersByKey[key];
  Chapter? chapterOf(Mission mission) => _chaptersByKey[mission.chapterKey];

  StoryCharacter? characterOf(Mission mission) => chapterOf(mission)?.character(mission.characterKey);

  /// The course for (track, source), or null when the track is unknown. Its chapters may be empty (planned course).
  Course? course(String trackId, String source) {
    final t = _tracksById[trackId];
    if (t == null) return null;
    return Course(
      track: t,
      source: source,
      chapters: [
        for (final c in chapters)
          if (c.courseTrackId == trackId && c.sourceLanguages.contains(source)) c,
      ],
    );
  }

  /// Instruction languages (among the interface's) a track can be learned from today: the catalog's (whether or not the
  /// course's chapters are loaded), or its loaded chapters'.
  List<String> sourcesFor(String trackId) {
    final track = _tracksById[trackId];
    return [
      for (final s in supportedInstructionLanguages)
        if ((track != null && track.sources.contains(s) && (track.missionCounts[s] ?? 0) > 0) ||
            chapters.any((c) => c.courseTrackId == trackId && c.sourceLanguages.contains(s) && c.missions.isNotEmpty))
          s,
    ];
  }

  bool isAvailable(String trackId, String source) => sourcesFor(trackId).contains(source);

  /// Tracks with content from [source], in catalog order.
  List<CourseTrackInfo> availableFrom(String source) => [
    for (final t in tracks)
      if (isAvailable(t.id, source)) t,
  ];
}

/// The bundle the app starts with: overridden in `main()` with the one loaded from the app's assets (the learner's
/// courses' chapters), and in tests with a parsed one.
final initialContentProvider = Provider<ContentBundle>((ref) => throw UnimplementedError('initialContentProvider must be overridden'));

/// Where the courses' chapters files are read from (the app's assets).
final assetBundleProvider = Provider<AssetBundle>((ref) => rootBundle);

/// The content bundle: the startup one, plus each course loaded since ([ContentLibrary.ensureTrack]).
final contentBundleProvider = NotifierProvider<ContentLibrary, ContentBundle>(ContentLibrary.new);

/// Loads a course's chapters into the bundle the first time it is needed (opened, enrolled, restored from the account).
class ContentLibrary extends Notifier<ContentBundle> {
  final _loading = <String, Future<void>>{};
  final _tried = <String>{};

  @override
  ContentBundle build() => ref.watch(initialContentProvider);

  /// Makes sure [trackId]'s chapters are in the bundle (one read of its file, however many callers wait for it).
  Future<void> ensureTrack(String trackId) {
    if (state.hasChaptersOf(trackId) || state.track(trackId) == null || _tried.contains(trackId)) return Future.value();
    return _loading[trackId] ??= () async {
      try {
        final chapters = await ContentBundle.loadChapters(ref.read(assetBundleProvider), trackId);
        _tried.add(trackId);
        state = state.withChapters(chapters);
      } finally {
        _loading.remove(trackId);
      }
    }();
  }
}
