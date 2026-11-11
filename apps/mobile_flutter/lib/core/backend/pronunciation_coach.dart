import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../audio/take_recorder.dart';
import '../services/app_state.dart';
import 'account.dart';
import 'api_client.dart';
import 'curriculum_ids.dart';
import 'server_course.dart';
import 'speech_check.dart';

/// How a take sounded, in the AI's estimate.
enum PronunciationBand { nativeLike, clearAccent, hardToUnderstand, offTarget, noSpeech }

/// One word of the phrase, as the AI heard it.
enum WordSound { good, unclear, mispronounced, missing }

@immutable
class FeedbackWord {
  const FeedbackWord({required this.word, required this.sound, this.tip});

  final String word;
  final WordSound sound;

  /// In the learner's instruction language.
  final String? tip;
}

/// AI pronunciation feedback on a take (`POST /v1/speech/pronunciation-feedback`): a listening model's estimate, never
/// an acoustic measurement, and not counted as progress.
@immutable
class PronunciationFeedback {
  const PronunciationFeedback({
    required this.score,
    required this.band,
    required this.matchesTarget,
    this.heard = '',
    this.heardIpa = '',
    this.targetIpa = '',
    this.words = const [],
    this.summary = '',
    this.tip = '',
  });

  factory PronunciationFeedback.fromResponse(Map<String, Object?> data) {
    String text(String key) => data[key] is String ? data[key] as String : '';
    return PronunciationFeedback(
      score: (data['score'] as num?)?.round(),
      band: switch (data['band']) {
        'native_like' => PronunciationBand.nativeLike,
        'clear_accent' => PronunciationBand.clearAccent,
        'hard_to_understand' => PronunciationBand.hardToUnderstand,
        'no_speech' => PronunciationBand.noSpeech,
        _ => PronunciationBand.offTarget,
      },
      matchesTarget: data['matchesTarget'] == true,
      heard: text('heard'),
      heardIpa: text('heardIpa'),
      targetIpa: text('targetIpa'),
      words: [
        for (final w in (data['words'] as List? ?? const []))
          if (w is Map && w['word'] is String)
            FeedbackWord(
              word: w['word'] as String,
              sound: switch (w['status']) {
                'good' => WordSound.good,
                'unclear' => WordSound.unclear,
                'missing' => WordSound.missing,
                _ => WordSound.mispronounced,
              },
              tip: w['tip'] is String && (w['tip'] as String).trim().isNotEmpty ? (w['tip'] as String).trim() : null,
            ),
      ],
      summary: text('summary'),
      tip: text('tip'),
    );
  }

  /// 0-100; null when nothing was listened to.
  final int? score;
  final PronunciationBand band;
  final bool matchesTarget;
  final String heard;
  final String heardIpa;
  final String targetIpa;
  final List<FeedbackWord> words;
  final String summary;
  final String tip;
}

class PronunciationFeedbackUnavailable implements Exception {
  const PronunciationFeedbackUnavailable(this.reason);
  final String reason;

  @override
  String toString() => 'PronunciationFeedbackUnavailable($reason)';
}

/// Listens to a take of a phrase and says how it sounded.
abstract class PronunciationCoach {
  Future<PronunciationFeedback> listen(RecordedTake take, SpeechTarget target);
}

class ApiPronunciationCoach implements PronunciationCoach {
  ApiPronunciationCoach({required this.api, required this.course, String Function()? newId}) : _newId = newId ?? randomUuid;

  final LangQuestApi api;
  final ServerCourse course;
  final String Function() _newId;

  @override
  Future<PronunciationFeedback> listen(RecordedTake take, SpeechTarget target) async {
    // Listening models take WAV (not WebM or MP4): the take is decoded and resampled here.
    final wav = await take.wav();
    if (wav == null || wav.length <= 44) throw const PronunciationFeedbackUnavailable('the take could not be decoded');
    // About 8 MB of base64 at most on the API: 15 s of 16 kHz mono is under 0.5 MB.
    if (wav.length > 5900000) throw const PronunciationFeedbackUnavailable('too long');
    try {
      final data = await api.pronunciationFeedback(
        enrollmentId: course.enrollmentId,
        targetVarietyId: course.targetVarietyId,
        expressionId: expressionServerId(target.expressionId),
        wavBase64: base64Encode(wav),
        clientRequestId: _newId(),
        peakLevelDb: take.peakLevelDb,
      );
      return PronunciationFeedback.fromResponse(data);
    } on ApiException catch (e) {
      throw PronunciationFeedbackUnavailable('${e.status} ${e.code}');
    }
  }
}

/// AI pronunciation feedback for the active course: offered where its takes can be checked by the server (signed in,
/// the course on the account, its speech checks on), since the same AI listens.
final pronunciationCoachProvider = Provider<PronunciationCoach?>((ref) {
  final api = ref.watch(apiProvider);
  final courseId = ref.watch(appStateProvider.select((s) => s.activeCourse?.id));
  final course = ref.watch(accountProvider).serverCourse(courseId);
  if (api == null || course == null || !course.speechCheck) return null;
  return ApiPronunciationCoach(api: api, course: course);
});
