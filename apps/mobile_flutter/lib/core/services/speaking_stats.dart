import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'learner_store.dart';

/// What the learner did out loud in one course, as measured on this device: takes the server checked (and how many
/// it understood), live calls and the time spent in them.
@immutable
class SpeakingStat {
  const SpeakingStat({this.checked = 0, this.understood = 0, this.calls = 0, this.seconds = 0});

  factory SpeakingStat.fromJson(Object? json) {
    if (json is! Map) return const SpeakingStat();
    int read(String k) => (json[k] as num?)?.toInt() ?? 0;
    return SpeakingStat(checked: read('checked'), understood: read('understood'), calls: read('calls'), seconds: read('seconds'));
  }

  final int checked;
  final int understood;
  final int calls;
  final int seconds;

  Map<String, Object?> toJson() => {'checked': checked, 'understood': understood, 'calls': calls, 'seconds': seconds};
}

class SpeakingStats extends Notifier<Map<String, SpeakingStat>> {
  static const key = 'langquest.speaking.v1';

  @override
  Map<String, SpeakingStat> build() {
    try {
      final raw = jsonDecode(ref.read(learnerStoreProvider).prefs.getString(key) ?? '{}');
      if (raw is Map) return {for (final e in raw.entries) '${e.key}': SpeakingStat.fromJson(e.value)};
    } catch (_) {}
    return {};
  }

  /// A take the server judged (understood or not; takes it could not judge are not counted).
  void recordCheck(String courseId, {required bool understood}) {
    final s = state[courseId] ?? const SpeakingStat();
    _set(courseId, SpeakingStat(checked: s.checked + 1, understood: s.understood + (understood ? 1 : 0), calls: s.calls, seconds: s.seconds));
  }

  /// A live call in which the learner spoke or wrote at least once.
  void recordCall(String courseId, Duration length) {
    final s = state[courseId] ?? const SpeakingStat();
    _set(courseId, SpeakingStat(checked: s.checked, understood: s.understood, calls: s.calls + 1, seconds: s.seconds + length.inSeconds));
  }

  /// Everything, for "Reset all progress".
  void clear() {
    state = {};
    unawaited(ref.read(learnerStoreProvider).prefs.remove(key));
  }

  void _set(String courseId, SpeakingStat stat) {
    state = {...state, courseId: stat};
    unawaited(ref.read(learnerStoreProvider).prefs.setString(key, jsonEncode({for (final e in state.entries) e.key: e.value.toJson()})));
  }
}

final speakingStatsProvider = NotifierProvider<SpeakingStats, Map<String, SpeakingStat>>(SpeakingStats.new);
