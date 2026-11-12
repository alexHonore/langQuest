import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:langquest_mobile/core/backend/api_client.dart';
import 'package:langquest_mobile/core/backend/curriculum_ids.dart';
import 'package:langquest_mobile/core/backend/pronunciation_coach.dart';
import 'package:langquest_mobile/core/backend/server_course.dart';
import 'package:langquest_mobile/core/backend/speech_check.dart';

import 'recording_fakes.dart';

const course = ServerCourse(enrollmentId: 'enr-1', targetVarietyId: 'es-ES', speechCheck: true);
const target = SpeechTarget(expressionId: 'es_es_ch1:es_greet:hola', chapterKey: 'es_es_ch1', missionKey: 'es_greet');

void main() {
  test('the take goes as WAV (what listening models hear) for the phrase\'s server id; the answer is read', () async {
    final sent = <Map<String, Object?>>[];
    final client = MockClient((request) async {
      sent.add((jsonDecode(request.body) as Map).cast<String, Object?>());
      return http.Response(
        jsonEncode({
          'ok': true,
          'data': {
            'feedbackId': '00000000-0000-4000-8000-000000000001',
            'targetVarietyId': 'es-ES',
            'method': 'ai_listening',
            'score': 62,
            'band': 'clear_accent',
            'matchesTarget': true,
            'heard': 'Hola, buenos días',
            'heardIpa': 'ˈoʊlɑ ˈbweɪnoʊs ˈdiːəs',
            'targetIpa': 'ˈola ˈbwenos ˈdias',
            'words': [
              {'word': 'Hola', 'status': 'mispronounced', 'tip': 'Keep the o pure.'},
              {'word': 'buenos', 'status': 'mispronounced', 'tip': ' '},
              {'word': 'días', 'status': 'good', 'tip': null},
            ],
            'summary': 'Understandable, with an English accent.',
            'tip': 'Keep vowels short and pure.',
            'model': 'google/gemini-3.8-flash',
            'version': 'ai-listening@2026-11-11.1',
          },
        }),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });
    final coach = ApiPronunciationCoach(
      api: LangQuestApi(baseUrl: 'https://api.test', accessToken: () async => 't', client: client),
      course: course,
      newId: () => '00000000-0000-4000-8000-0000000000aa',
    );
    final take = FakeTake(peakLevelDb: -9);
    final feedback = await coach.listen(take, target);
    final body = sent.single;
    expect(body['expressionId'], expressionServerId(target.expressionId));
    expect((body['enrollmentId'], body['targetVarietyId']), ('enr-1', 'es-ES'));
    final audio = body['audio']! as Map;
    expect((audio['source'], audio['encoding'], audio['sampleRateHz']), ('inline', 'wav', 16000));
    expect(base64Decode(audio['base64'] as String), take.wavBytes, reason: 'the decoded WAV, not the WebM take');
    expect(body['recording'], {'peakLevelDb': -9.0});
    expect((feedback.score, feedback.band, feedback.matchesTarget), (62, PronunciationBand.clearAccent, true));
    expect(
      [for (final w in feedback.words) (w.word, w.sound, w.tip)],
      [('Hola', WordSound.mispronounced, 'Keep the o pure.'), ('buenos', WordSound.mispronounced, null), ('días', WordSound.good, null)],
    );
    expect(feedback.tip, 'Keep vowels short and pure.');
  });

  test('a take the device cannot decode is not sent; a server refusal is "unavailable"', () async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      return http.Response(
        jsonEncode({
          'ok': false,
          'error': {'code': 'provider_unavailable', 'message': 'x'},
        }),
        503,
        headers: {'content-type': 'application/json'},
      );
    });
    final coach = ApiPronunciationCoach(
      api: LangQuestApi(baseUrl: 'https://api.test', accessToken: () async => 't', client: client),
      course: course,
    );
    await expectLater(coach.listen(FakeTake()..wavBytes = null, target), throwsA(isA<PronunciationFeedbackUnavailable>()));
    expect(calls, 0);
    await expectLater(coach.listen(FakeTake(), target), throwsA(isA<PronunciationFeedbackUnavailable>()));
    expect(calls, greaterThanOrEqualTo(1));
  });

  test('no speech, and unknown statuses, are read safely', () {
    final silent = PronunciationFeedback.fromResponse({'score': null, 'band': 'no_speech', 'matchesTarget': false, 'words': []});
    expect((silent.score, silent.band), (null, PronunciationBand.noSpeech));
    final odd = PronunciationFeedback.fromResponse({
      'score': 40.4,
      'band': 'something_new',
      'words': [
        {'word': 'x', 'status': '???'},
      ],
    });
    expect((odd.score, odd.band, odd.words.single.sound), (40, PronunciationBand.offTarget, WordSound.mispronounced));
  });
}
