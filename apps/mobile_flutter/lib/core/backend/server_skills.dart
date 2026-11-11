import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/app_state.dart';
import 'account.dart';

/// The server's mastery ladder (`packages/curriculum` mastery states), lowest first. Only evidence moves a skill up:
/// takes the server understood, mission steps, live-call goals.
enum Mastery { notAttempted, emerging, practiced, independent, durable }

Mastery? masteryFrom(Object? value) => switch (value) {
  'not_attempted' => Mastery.notAttempted,
  'emerging' => Mastery.emerging,
  'practiced' => Mastery.practiced,
  'independent' => Mastery.independent,
  'durable' => Mastery.durable,
  _ => null,
};

/// One skill as `GET /v1/me/skills` reports it for an enrollment.
@immutable
class ServerSkill {
  const ServerSkill({required this.key, required this.mastery, required this.evidence, this.lastPracticedAt});

  /// Stable skill key (`greet_politely`, `speaking.intelligibility`).
  final String key;
  final Mastery mastery;

  /// How many observations the estimate rests on.
  final int evidence;
  final DateTime? lastPracticedAt;

  /// Step on the four-step ladder (emerging = 1 … durable = 4; 0 when not attempted).
  int get step => mastery.index;

  /// Null for an item without a key or with a state this app does not know.
  static ServerSkill? fromJson(Map<String, Object?> json) {
    final key = json['skillKey'];
    final mastery = masteryFrom(json['masteryState']);
    if (key is! String || key.isEmpty || mastery == null) return null;
    final evidence = json['evidenceCount'];
    final last = json['lastPracticedAt'];
    return ServerSkill(
      key: key,
      mastery: mastery,
      evidence: evidence is num ? evidence.toInt() : 0,
      lastPracticedAt: last is String ? DateTime.tryParse(last) : null,
    );
  }
}

/// What the learner can do, strongest first: every skill with a measured state (not "not attempted"), ordered by
/// mastery, then by how much evidence it rests on, then by key (stable).
List<ServerSkill> canDoList(Iterable<ServerSkill> skills) =>
    [
      for (final s in skills)
        if (s.mastery != Mastery.notAttempted) s,
    ]..sort((a, b) {
      final byMastery = b.mastery.index.compareTo(a.mastery.index);
      if (byMastery != 0) return byMastery;
      final byEvidence = b.evidence.compareTo(a.evidence);
      return byEvidence != 0 ? byEvidence : a.key.compareTo(b.key);
    });

/// The enrollment whose skills Progress shows: the active course's, when it is on the learner's account and the API is
/// configured; null otherwise (signed out, or a course not on this account). Synchronous, so Progress shows nothing
/// at all — not even a loading row — for a learner without an account course.
final skillsEnrollmentProvider = Provider<String?>((ref) {
  final courseId = ref.watch(appStateProvider.select((s) => s.activeCourse?.id));
  final enrollmentId = ref.watch(accountProvider.select((a) => a.serverCourse(courseId)?.enrollmentId));
  return enrollmentId != null && ref.watch(apiProvider) != null ? enrollmentId : null;
});

/// The active course's skills as the server measured them, strongest first (empty without an account course).
/// Fetched each time Progress opens (autoDispose).
final serverSkillsProvider = FutureProvider.autoDispose<List<ServerSkill>>((ref) async {
  final enrollmentId = ref.watch(skillsEnrollmentProvider);
  final api = ref.watch(apiProvider);
  if (enrollmentId == null || api == null) return const [];
  final items = await api.skills(enrollmentId);
  return canDoList([for (final i in items) ?ServerSkill.fromJson(i)]);
});
