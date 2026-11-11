import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/services/learner_store.dart';
import 'call_session.dart';

/// One line of a call's transcript, as kept on the device.
@immutable
class CallRecordLine {
  const CallRecordLine({required this.fromLearner, required this.text, this.transliteration, this.gloss});

  factory CallRecordLine.fromJson(Map<Object?, Object?> json) => CallRecordLine(
    fromLearner: json['l'] == true,
    text: '${json['t'] ?? ''}',
    transliteration: json['tr'] is String ? json['tr'] as String : null,
    gloss: json['g'] is String ? json['g'] as String : null,
  );

  final bool fromLearner;
  final String text;
  final String? transliteration;

  /// The character's line in the learner's instruction language, when the server wrote one.
  final String? gloss;

  Map<String, Object?> toJson() => {'l': fromLearner, 't': text, 'tr': ?transliteration, 'g': ?gloss};
}

/// A call the learner took part in, kept on this device so they can reread it: who, when, how long, the goals, the
/// server's summary and corrections, and what was said. Never sent anywhere; "Reset all progress" deletes it.
@immutable
class CallRecord {
  const CallRecord({
    required this.id,
    required this.courseId,
    required this.at,
    required this.seconds,
    required this.characterName,
    this.characterRole = '',
    this.characterId,
    this.missionKey,
    this.title = '',
    this.goalCount = 0,
    this.goalsMet = 0,
    this.goalsDone = const [],
    this.goalsOpen = const [],
    this.summary = '',
    this.corrections = const [],
    this.xp = 0,
    this.evaluated = false,
    this.lines = const [],
  });

  /// The record of an ended [session] (its goals as the server counted them at the end, its last 60 lines).
  factory CallRecord.fromSession(
    CallSession session, {
    required String courseId,
    required DateTime at,
    required int seconds,
    String? missionKey,
    String title = '',
  }) {
    final summary = session.summary;
    final met = summary != null
        ? summary.objectivesMet.toSet()
        : {
            for (final o in session.objectives)
              if (o.done) o.id,
          };
    final heard = [
      for (final l in session.lines)
        if (!l.pending && (l.text ?? '').trim().isNotEmpty)
          CallRecordLine(fromLearner: l.fromLearner, text: l.text!, transliteration: l.transliteration, gloss: l.gloss),
    ];
    return CallRecord(
      id: session.sessionId ?? 'local-${at.microsecondsSinceEpoch}',
      courseId: courseId,
      at: at,
      seconds: seconds,
      characterName: session.character?.name ?? '',
      characterRole: session.character?.role ?? '',
      characterId: session.character?.id ?? session.characterId,
      missionKey: missionKey,
      title: title,
      goalCount: session.objectives.length,
      goalsMet: session.objectives.where((o) => met.contains(o.id)).length,
      goalsDone: [
        for (final o in session.objectives)
          if (met.contains(o.id) && o.description.trim().isNotEmpty) o.description,
      ],
      goalsOpen: [
        for (final o in session.objectives)
          if (!met.contains(o.id) && o.description.trim().isNotEmpty) o.description,
      ],
      summary: summary?.summary ?? '',
      corrections: summary?.corrections ?? const [],
      xp: summary?.xp ?? 0,
      evaluated: summary?.evaluated ?? false,
      lines: heard.length > 60 ? heard.sublist(heard.length - 60) : heard,
    );
  }

  static CallRecord? fromJson(Object? json) {
    if (json is! Map || json['id'] is! String || json['course'] is! String) return null;
    final at = DateTime.tryParse('${json['at']}');
    if (at == null) return null;
    List<String> strings(Object? v) => v is List ? [for (final s in v) '$s'] : const [];
    int number(String key) => (json[key] as num?)?.toInt() ?? 0;
    return CallRecord(
      id: json['id'] as String,
      courseId: json['course'] as String,
      at: at,
      seconds: number('seconds'),
      characterName: '${json['name'] ?? ''}',
      characterRole: '${json['role'] ?? ''}',
      characterId: json['character'] is String ? json['character'] as String : null,
      missionKey: json['mission'] is String ? json['mission'] as String : null,
      title: '${json['title'] ?? ''}',
      goalCount: number('goals'),
      goalsMet: number('met'),
      goalsDone: strings(json['done']),
      goalsOpen: strings(json['open']),
      summary: '${json['summary'] ?? ''}',
      corrections: [
        for (final c in (json['corrections'] as List? ?? const []))
          if (c is Map) CallCorrection(said: '${c['said'] ?? ''}', better: '${c['better'] ?? ''}', why: '${c['why'] ?? ''}'),
      ],
      xp: number('xp'),
      evaluated: json['evaluated'] == true,
      lines: [
        for (final l in (json['lines'] as List? ?? const []))
          if (l is Map) CallRecordLine.fromJson(l),
      ],
    );
  }

  /// The session's id on the server (or a local one): the record's key.
  final String id;
  final String courseId;
  final DateTime at;
  final int seconds;
  final String characterName;
  final String characterRole;

  /// The server's `characters.id` (a free call can be made again with it).
  final String? characterId;

  /// The mission the call practised, or null for a free call.
  final String? missionKey;

  /// The mission's title in the instruction language, for a mission call.
  final String title;

  /// How many goals the call had, and how many the server counted as met.
  final int goalCount;
  final int goalsMet;

  /// The goals met, and still open, by their wording (goals the server could not word are only counted).
  final List<String> goalsDone;
  final List<String> goalsOpen;
  final String summary;
  final List<CallCorrection> corrections;
  final int xp;

  /// An evaluator judged the call (otherwise nothing was claimed).
  final bool evaluated;
  final List<CallRecordLine> lines;

  Map<String, Object?> toJson() => {
    'id': id,
    'course': courseId,
    'at': at.toUtc().toIso8601String(),
    'seconds': seconds,
    'name': characterName,
    if (characterRole.isNotEmpty) 'role': characterRole,
    'character': ?characterId,
    'mission': ?missionKey,
    if (title.isNotEmpty) 'title': title,
    'goals': goalCount,
    'met': goalsMet,
    if (goalsDone.isNotEmpty) 'done': goalsDone,
    if (goalsOpen.isNotEmpty) 'open': goalsOpen,
    if (summary.isNotEmpty) 'summary': summary,
    if (corrections.isNotEmpty)
      'corrections': [
        for (final c in corrections) {'said': c.said, 'better': c.better, 'why': c.why},
      ],
    'xp': xp,
    'evaluated': evaluated,
    if (lines.isNotEmpty) 'lines': [for (final l in lines) l.toJson()],
  };
}

/// The learner's calls on this device, newest first, at most [perCourse] per course (the oldest are dropped).
class CallHistory extends Notifier<List<CallRecord>> {
  static const key = 'langquest.calls.v1';
  static const perCourse = 20;

  @override
  List<CallRecord> build() {
    try {
      final raw = jsonDecode(ref.read(learnerStoreProvider).prefs.getString(key) ?? '[]');
      if (raw is List) return [for (final r in raw) ?CallRecord.fromJson(r)]..sort((a, b) => b.at.compareTo(a.at));
    } catch (_) {}
    return const [];
  }

  /// A call the learner took part in (replaces a record with the same id).
  void add(CallRecord record) {
    final rest = [
      for (final r in state)
        if (r.id != record.id) r,
    ];
    final course = [
      record,
      for (final r in rest)
        if (r.courseId == record.courseId) r,
    ].take(perCourse);
    state = [
      ...course,
      for (final r in rest)
        if (r.courseId != record.courseId) r,
    ]..sort((a, b) => b.at.compareTo(a.at));
    _save();
  }

  void remove(String id) {
    state = [
      for (final r in state)
        if (r.id != id) r,
    ];
    _save();
  }

  /// Everything, for "Reset all progress".
  void clear() {
    state = const [];
    unawaited(ref.read(learnerStoreProvider).prefs.remove(key));
  }

  void _save() => unawaited(ref.read(learnerStoreProvider).prefs.setString(key, jsonEncode([for (final r in state) r.toJson()])));
}

final callHistoryProvider = NotifierProvider<CallHistory, List<CallRecord>>(CallHistory.new);

/// One course's calls, newest first.
final courseCallsProvider = Provider.family<List<CallRecord>, String>(
  (ref, courseId) => [
    for (final r in ref.watch(callHistoryProvider))
      if (r.courseId == courseId) r,
  ],
);
