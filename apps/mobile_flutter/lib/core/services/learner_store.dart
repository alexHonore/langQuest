import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'learner_state.dart';

/// Keeps [LearnerState] on the device (SharedPreferences: NSUserDefaults / SharedPreferences / localStorage).
class LearnerStore {
  static const key = 'langquest.learner.v1';
  final SharedPreferences _prefs;

  LearnerStore(this._prefs);

  LearnerState load() {
    final raw = _prefs.getString(key);
    if (raw == null) return const LearnerState();
    try {
      return LearnerState.fromJson(jsonDecode(raw));
    } on FormatException catch (e) {
      // A damaged entry must not lock the learner out of the app; start fresh and say so in the logs.
      debugPrint('LearnerStore: unreadable saved state ($e); starting from defaults');
      return const LearnerState();
    }
  }

  Future<void> save(LearnerState state) => _prefs.setString(key, jsonEncode(state.toJson()));

  Future<void> clear() => _prefs.remove(key);
}

/// Overridden in `main()` (and in tests) with a store over the platform preferences.
final learnerStoreProvider = Provider<LearnerStore>((ref) => throw UnimplementedError('learnerStoreProvider must be overridden'));
