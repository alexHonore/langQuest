import 'dart:convert';

import 'package:flutter/services.dart' show AssetBundle;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'content_models.dart';

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

/// The offline content bundle: the 30-track catalog, the draft chapters and the names of the skills the server tracks.
class ContentBundle {
  final List<CourseTrackInfo> tracks;
  final List<Chapter> chapters;
  final Map<String, SkillInfo> skills;

  /// The cast's roles by roster id, then by language (`cast.json`; the server's characters carry an English role).
  final Map<String, Map<String, String>> roles;
  final Map<String, CourseTrackInfo> _tracksById;
  final Map<String, Mission> _missionsByKey;
  final Map<String, Chapter> _chaptersByKey;

  ContentBundle({required this.tracks, required this.chapters, this.skills = const {}, this.roles = const {}})
    : _tracksById = {for (final t in tracks) t.id: t},
      _missionsByKey = {
        for (final c in chapters)
          for (final m in c.missions) m.key: m,
      },
      _chaptersByKey = {for (final c in chapters) c.key: c};

  static const catalogAsset = 'assets/content/catalog.json';
  static const chaptersAsset = 'assets/content/chapters.json';
  static const skillsAsset = 'assets/content/skills.json';
  static const castAsset = 'assets/content/cast.json';

  /// Parse the bundle files; throws [FormatException] on an unsupported schema version.
  factory ContentBundle.parse({required String catalogJson, required String chaptersJson, String? skillsJson, String? castJson}) {
    final catalog = (jsonDecode(catalogJson) as Map).cast<String, Object?>();
    final chapters = (jsonDecode(chaptersJson) as Map).cast<String, Object?>();
    final skills = skillsJson == null ? null : (jsonDecode(skillsJson) as Map).cast<String, Object?>();
    final cast = castJson == null ? null : (jsonDecode(castJson) as Map).cast<String, Object?>();
    for (final doc in [catalog, chapters, ?skills, ?cast]) {
      if (doc['schemaVersion'] != 1) throw FormatException('Unsupported content bundle schemaVersion ${doc['schemaVersion']}');
    }
    final tracks = [for (final t in (catalog['tracks'] as List? ?? const [])) CourseTrackInfo.fromJson((t as Map).cast<String, Object?>())]
      ..sort((a, b) => a.order.compareTo(b.order));
    return ContentBundle(
      tracks: tracks,
      chapters: [for (final c in (chapters['chapters'] as List? ?? const [])) Chapter.fromJson((c as Map).cast<String, Object?>())],
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
    );
  }

  static Future<ContentBundle> load(AssetBundle assets) async => ContentBundle.parse(
    catalogJson: await assets.loadString(catalogAsset),
    chaptersJson: await assets.loadString(chaptersAsset),
    skillsJson: await assets.loadString(skillsAsset),
    castJson: await assets.loadString(castAsset),
  );

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

  /// Instruction languages (among the interface's) a track can be learned from today.
  List<String> sourcesFor(String trackId) => [
    for (final s in supportedInstructionLanguages)
      if (chapters.any((c) => c.courseTrackId == trackId && c.sourceLanguages.contains(s) && c.missions.isNotEmpty)) s,
  ];

  bool isAvailable(String trackId, String source) => sourcesFor(trackId).contains(source);

  /// Tracks with content from [source], in catalog order.
  List<CourseTrackInfo> availableFrom(String source) => [
    for (final t in tracks)
      if (isAvailable(t.id, source)) t,
  ];
}

/// Overridden in `main()` with the bundle loaded from the app's assets (and in tests with a parsed one).
final contentBundleProvider = Provider<ContentBundle>((ref) => throw UnimplementedError('contentBundleProvider must be overridden'));
