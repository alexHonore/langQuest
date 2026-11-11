import 'package:flutter/foundation.dart';

/// One of the learner's courses as their account holds it: its enrollment and what the server's AI can do for it
/// (the `capabilities` snapshot `GET /v1/me` sends with each enrollment). The AI features are offered only for a
/// course whose snapshot says they work (visible means usable).
@immutable
class ServerCourse {
  const ServerCourse({
    required this.enrollmentId,
    required this.targetVarietyId,
    this.speechCheck = false,
    this.liveConversation = false,
    this.voiceConversation = false,
    this.audioLibrary = false,
  });

  final String enrollmentId;

  /// The variety the course teaches (`es-ES`, `ary-MA`…): the speech routes check it against the enrollment.
  final String targetVarietyId;

  /// The server can tell whether a spoken take said the phrase (`pronunciationScoring.mode` is not `none`).
  final bool speechCheck;

  /// The course's characters can be called for a live conversation.
  final bool liveConversation;

  /// …by voice (`text_and_voice`), not only in writing.
  final bool voiceConversation;

  /// The server publishes audio lessons for the course.
  final bool audioLibrary;

  /// From one entry of `GET /v1/me` `enrollments`; null when it is not an active enrollment.
  static ServerCourse? fromEnrollment(Object? json) {
    if (json is! Map || json['status'] != 'active' || json['id'] is! String || json['targetVarietyId'] is! String) return null;
    final caps = json['capabilities'] is Map ? json['capabilities'] as Map : const {};
    Map<Object?, Object?> part(String key) => caps[key] is Map ? caps[key] as Map : const {};
    final conversation = part('liveConversation');
    final mode = '${conversation['mode']}';
    final scoring = '${part('pronunciationScoring')['mode']}';
    return ServerCourse(
      enrollmentId: json['id'] as String,
      targetVarietyId: json['targetVarietyId'] as String,
      speechCheck: scoring == 'reference_comparison' || scoring == 'acoustic',
      liveConversation: conversation['available'] == true && mode != 'none',
      voiceConversation: conversation['available'] == true && mode == 'text_and_voice',
      audioLibrary: part('audioLibrary')['available'] == true,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is ServerCourse &&
      other.enrollmentId == enrollmentId &&
      other.targetVarietyId == targetVarietyId &&
      other.speechCheck == speechCheck &&
      other.liveConversation == liveConversation &&
      other.voiceConversation == voiceConversation &&
      other.audioLibrary == audioLibrary;

  @override
  int get hashCode => Object.hash(enrollmentId, targetVarietyId, speechCheck, liveConversation, voiceConversation, audioLibrary);
}

/// Whether the account keeps the learner's recordings (`privacyOptions.store_speech_recordings`, `none` unless the
/// learner opted in): the app says so where a take is sent to be checked.
bool accountKeepsRecordings(Map<String, Object?> me) {
  final privacy = me['privacyOptions'];
  if (privacy is! Map) return false;
  final retention = privacy['store_speech_recordings'] ?? privacy['storeSpeechRecordings'];
  return retention == 'opt_in_30_days' || retention == 'opt_in_until_deleted';
}

/// What the server offers one course before enrolling (`GET /v1/courses` summary): the course page says it.
@immutable
class ServerTrackOffer {
  const ServerTrackOffer({this.characters = 0, this.liveCalls = false, this.spokenCheck = false, this.aiVoice = false, this.audioLessons = 0});

  final int characters;

  /// Live conversation with the course's characters (with an account).
  final bool liveCalls;

  /// Spoken answers checked for meaning (with an account).
  final bool spokenCheck;

  /// Server synthesis of the course's lines.
  final bool aiVoice;
  final int audioLessons;

  static ServerTrackOffer fromSummary(Map<String, Object?> course) {
    final caps = course['capabilities'] is Map ? course['capabilities'] as Map : const {};
    final characters = (course['characterCount'] as num?)?.toInt() ?? 0;
    final scoring = '${caps['pronunciationScoring'] ?? 'none'}';
    return ServerTrackOffer(
      characters: characters,
      liveCalls: caps['realtimeConversation'] == true && characters > 0,
      spokenCheck: caps['speechRecognition'] == true && scoring != 'none',
      aiVoice: caps['speechSynthesis'] == true,
      audioLessons: (course['publishedAudioLessonCount'] as num?)?.toInt() ?? 0,
    );
  }
}
