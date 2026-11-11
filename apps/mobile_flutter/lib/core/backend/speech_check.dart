import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../audio/take_recorder.dart';
import '../services/app_state.dart';
import 'account.dart';
import 'api_client.dart';
import 'curriculum_ids.dart';
import 'server_course.dart';

/// What the server made of one spoken take, in the API's one outcome vocabulary (`speechObservationOutcome`):
/// the meaning came across, it did not, the recognizer was unsure (never blamed), or there was no speech at all.
/// About meaning, never a pronunciation score: the course's scorer compares with the reference (ADR-006).
enum SpeechVerdictKind { understood, notUnderstood, unsure, noSpeech }

@immutable
class SpeechVerdict {
  const SpeechVerdict(this.kind, {this.heard, this.assessmentId});

  /// From a `pronunciation-assess` response.
  factory SpeechVerdict.fromResponse(Map<String, Object?> data) {
    final intelligibility = data['intelligibility'];
    final matched = data['semanticIntentMatched'] == true;
    final kind = switch (data['outcome']) {
      'success' => SpeechVerdictKind.understood,
      'unclear' => intelligibility == 'no_speech_detected' ? SpeechVerdictKind.noSpeech : SpeechVerdictKind.unsure,
      'fail' || 'partial' => SpeechVerdictKind.notUnderstood,
      // An older server without `outcome`: the same rule from its parts.
      _ =>
        intelligibility == 'no_speech_detected'
            ? SpeechVerdictKind.noSpeech
            : matched && intelligibility == 'understood'
            ? SpeechVerdictKind.understood
            : SpeechVerdictKind.notUnderstood,
    };
    final heard = data['transcript'];
    return SpeechVerdict(kind, heard: heard is String && heard.trim().isNotEmpty ? heard.trim() : null, assessmentId: data['assessmentId'] as String?);
  }

  final SpeechVerdictKind kind;

  /// What the recognizer heard; null when nothing was heard.
  final String? heard;
  final String? assessmentId;

  bool get understood => kind == SpeechVerdictKind.understood;
}

/// The phrase a take should say, and the mission it belongs to (the server's grading row then backs that mission's
/// speaking steps).
@immutable
class SpeechTarget {
  const SpeechTarget({required this.expressionId, this.chapterKey, this.missionKey});

  /// The bundle's expression id (`<chapter>:<mission>:<expression>`).
  final String expressionId;
  final String? chapterKey;
  final String? missionKey;
}

/// The check could not be made (offline, the server refused this phrase, AI unavailable): the learner compares by ear.
class SpeechCheckUnavailable implements Exception {
  const SpeechCheckUnavailable(this.reason);
  final String reason;

  @override
  String toString() => 'SpeechCheckUnavailable($reason)';
}

/// Checks spoken takes on the server, for one course of the signed-in learner.
abstract class SpeechChecker {
  /// Whether the account keeps recordings (the learner opted in); else a take is checked and not kept.
  bool get keepsRecordings;

  /// Throws [SpeechCheckUnavailable] when the take could not be checked.
  Future<SpeechVerdict> check(RecordedTake take, SpeechTarget target);
}

class ApiSpeechChecker implements SpeechChecker {
  ApiSpeechChecker({required this.api, required this.course, required this.keepsRecordings, String Function()? newId}) : _newId = newId ?? randomUuid;

  final LangQuestApi api;
  final ServerCourse course;
  @override
  final bool keepsRecordings;
  final String Function() _newId;

  @override
  Future<SpeechVerdict> check(RecordedTake take, SpeechTarget target) async {
    final encoding = apiEncodingFor(take.mimeType);
    if (encoding == null) throw SpeechCheckUnavailable('no API encoding for ${take.mimeType}');
    final bytes = await take.bytes();
    // The API takes at most 8 MB of base64 (a few minutes of speech; a take stops at 15 s).
    if (bytes.isEmpty || bytes.length > 5900000) throw const SpeechCheckUnavailable('empty or too long');
    final chapter = target.chapterKey;
    final mission = target.missionKey;
    try {
      final data = await api.assessSpeech(
        enrollmentId: course.enrollmentId,
        targetVarietyId: course.targetVarietyId,
        expressionId: expressionServerId(target.expressionId),
        audioBase64: base64Encode(bytes),
        encoding: encoding,
        clientRequestId: _newId(),
        scenarioId: chapter != null && mission != null ? missionServerId(chapter, mission) : null,
        peakLevelDb: take.peakLevelDb,
      );
      return SpeechVerdict.fromResponse(data);
    } on ApiException catch (e) {
      throw SpeechCheckUnavailable('${e.status} ${e.code}');
    }
  }
}

/// The speech checker of the active course: null unless the learner is signed in, the server answers, and the
/// course's snapshot says takes can be checked; the record step then stays listen / record / compare.
final speechCheckerProvider = Provider<SpeechChecker?>((ref) {
  final api = ref.watch(apiProvider);
  final account = ref.watch(accountProvider);
  final courseId = ref.watch(appStateProvider.select((s) => s.activeCourse?.id));
  final course = account.serverCourse(courseId);
  if (api == null || course == null || !course.speechCheck) return null;
  return ApiSpeechChecker(api: api, course: course, keepsRecordings: account.lastReport?.keepsRecordings ?? false);
});
