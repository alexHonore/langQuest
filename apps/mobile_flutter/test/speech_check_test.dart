import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:langquest_mobile/core/backend/account.dart';
import 'package:langquest_mobile/core/backend/api_client.dart';
import 'package:langquest_mobile/core/backend/auth_gateway.dart';
import 'package:langquest_mobile/core/backend/curriculum_ids.dart';
import 'package:langquest_mobile/core/backend/server_course.dart';
import 'package:langquest_mobile/core/backend/speech_check.dart';
import 'package:langquest_mobile/core/backend/sync_service.dart';

import 'recording_fakes.dart';

Map<String, Object?> enrollment({
  String status = 'active',
  String scoring = 'reference_comparison',
  String conversation = 'text_and_voice',
  bool library = false,
}) => {
  'id': 'enr-1',
  'courseTrackId': 'spanish-spain',
  'sourceLanguageCode': 'en',
  'targetVarietyId': 'es-ES',
  'status': status,
  'capabilities': {
    'audioLibrary': {'available': library, 'publishedCollections': library ? 2 : 0},
    'liveConversation': {'available': conversation != 'none', 'characterCount': 3, 'mode': conversation},
    'pronunciationScoring': {'mode': scoring},
  },
};

void main() {
  group('SpeechVerdict from the API', () {
    SpeechVerdict verdict(Map<String, Object?> data) => SpeechVerdict.fromResponse({'assessmentId': 'a-1', ...data});

    test('the server\'s one outcome vocabulary', () {
      expect(verdict({'outcome': 'success', 'intelligibility': 'understood', 'transcript': ' hola '}).kind, SpeechVerdictKind.understood);
      expect(verdict({'outcome': 'success', 'transcript': ' hola '}).heard, 'hola');
      expect(
        verdict({'outcome': 'fail', 'intelligibility': 'partially_understood'}).kind,
        SpeechVerdictKind.notUnderstood,
        reason: 'partial overlap is not partial credit',
      );
      expect(verdict({'outcome': 'unclear', 'intelligibility': 'partially_understood'}).kind, SpeechVerdictKind.unsure);
      expect(verdict({'outcome': 'unclear', 'intelligibility': 'no_speech_detected', 'transcript': null}).kind, SpeechVerdictKind.noSpeech);
      expect(verdict({'outcome': 'unclear', 'transcript': '  '}).heard, isNull);
    });

    test('an older server without `outcome`: the same rule from its parts', () {
      expect(verdict({'semanticIntentMatched': true, 'intelligibility': 'understood'}).kind, SpeechVerdictKind.understood);
      expect(verdict({'semanticIntentMatched': false, 'intelligibility': 'not_understood'}).kind, SpeechVerdictKind.notUnderstood);
      expect(verdict({'semanticIntentMatched': false, 'intelligibility': 'no_speech_detected'}).kind, SpeechVerdictKind.noSpeech);
    });
  });

  group('ApiSpeechChecker', () {
    const course = ServerCourse(enrollmentId: 'enr-1', targetVarietyId: 'es-ES', speechCheck: true);
    const target = SpeechTarget(
      expressionId: 'es_es_ch1_arrival_madrid:es_greet_and_introduce:hola',
      chapterKey: 'es_es_ch1_arrival_madrid',
      missionKey: 'es_greet_and_introduce',
    );

    test('sends the take inline, names the phrase and the mission by their server ids, and reads the verdict', () async {
      late Map<String, Object?> sent;
      final client = MockClient((req) async {
        expect('${req.method} ${req.url.path}', 'POST /v1/speech/pronunciation-assess');
        expect(req.headers['Authorization'], 'Bearer t');
        sent = (jsonDecode(req.body) as Map).cast<String, Object?>();
        return http.Response(
          jsonEncode({
            'ok': true,
            'data': {
              'assessmentId': 'a-1',
              'outcome': 'success',
              'intelligibility': 'understood',
              'semanticIntentMatched': true,
              'transcript': 'Hola, buenos días',
            },
          }),
          200,
        );
      });
      final checker = ApiSpeechChecker(
        api: LangQuestApi(baseUrl: 'https://api.test', accessToken: () async => 't', client: client),
        course: course,
        keepsRecordings: false,
        newId: () => '00000000-0000-4000-8000-000000000001',
      );
      final verdict = await checker.check(FakeTake(peakLevelDb: -12.5), target);
      expect(verdict.understood, isTrue);
      expect(verdict.heard, 'Hola, buenos días');
      expect(verdict.assessmentId, 'a-1');
      expect(sent['enrollmentId'], 'enr-1');
      expect(sent['targetVarietyId'], 'es-ES');
      // The seed's ids (verified against the live server: `bf0c634b-…` for this phrase).
      expect(sent['expressionId'], expressionServerId(target.expressionId));
      expect(sent['expressionId'], 'bf0c634b-f74c-5b3a-bcb9-3cab98087e10');
      expect(sent['scenarioId'], missionServerId('es_es_ch1_arrival_madrid', 'es_greet_and_introduce'), reason: 'the grading row backs the mission');
      expect(sent['clientRequestId'], '00000000-0000-4000-8000-000000000001');
      expect(sent['audio'], {
        'source': 'inline',
        'base64': base64Encode(const [26, 69, 223, 163]),
        'encoding': 'webm_opus',
        'sampleRateHz': null,
      });
      expect(sent['recording'], {'peakLevelDb': -12.5});
    });

    test('a refusal or a network failure is "could not check", never a verdict', () async {
      for (final response in [
        () => http.Response(
          jsonEncode({
            'ok': false,
            'error': {'code': 'not_found', 'message': 'Expression'},
          }),
          404,
        ),
        () => throw http.ClientException('offline'),
      ]) {
        final checker = ApiSpeechChecker(
          api: LangQuestApi(baseUrl: 'https://api.test', accessToken: () async => 't', client: MockClient((_) async => response())),
          course: course,
          keepsRecordings: false,
        );
        await expectLater(checker.check(FakeTake(), target), throwsA(isA<SpeechCheckUnavailable>()));
      }
    });

    test('random request ids are version-4 UUIDs', () {
      final ids = {for (var i = 0; i < 50; i++) randomUuid()};
      expect(ids, hasLength(50));
      for (final id in ids) {
        expect(RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$').hasMatch(id), isTrue, reason: id);
      }
    });
  });

  group('the account\'s courses', () {
    test('read from an enrollment\'s capability snapshot', () {
      final course = ServerCourse.fromEnrollment(enrollment())!;
      expect(course.enrollmentId, 'enr-1');
      expect(course.targetVarietyId, 'es-ES');
      expect(course.speechCheck, isTrue);
      expect(course.liveConversation, isTrue);
      expect(course.voiceConversation, isTrue);
      expect(course.audioLibrary, isFalse);

      expect(ServerCourse.fromEnrollment(enrollment(scoring: 'none'))!.speechCheck, isFalse);
      expect(ServerCourse.fromEnrollment(enrollment(scoring: 'acoustic'))!.speechCheck, isTrue);
      final written = ServerCourse.fromEnrollment(enrollment(conversation: 'text_only'))!;
      expect((written.liveConversation, written.voiceConversation), (true, false));
      expect(ServerCourse.fromEnrollment(enrollment(conversation: 'none'))!.liveConversation, isFalse);
      expect(ServerCourse.fromEnrollment(enrollment(library: true))!.audioLibrary, isTrue);
      expect(ServerCourse.fromEnrollment(enrollment(status: 'archived')), isNull);
      expect(ServerCourse.fromEnrollment({'id': 'x', 'status': 'active'}), isNull, reason: 'no variety, no AI');
    });

    test('by course id, from GET /v1/me', () {
      expect(
        SyncService.serverCourses({
          'enrollments': [enrollment(), enrollment(status: 'archived')..['courseTrackId'] = 'japanese'],
        }).keys,
        ['spanish-spain|en'],
      );
    });

    test('whether the account keeps recordings: only when the learner opted in', () {
      expect(accountKeepsRecordings({'privacyOptions': null}), isFalse);
      expect(
        accountKeepsRecordings({
          'privacyOptions': {'store_speech_recordings': 'none'},
        }),
        isFalse,
      );
      expect(
        accountKeepsRecordings({
          'privacyOptions': {'store_speech_recordings': 'session'},
        }),
        isFalse,
      );
      expect(
        accountKeepsRecordings({
          'privacyOptions': {'store_speech_recordings': 'opt_in_30_days'},
        }),
        isTrue,
      );
      expect(
        accountKeepsRecordings({
          'privacyOptions': {'storeSpeechRecordings': 'opt_in_until_deleted'},
        }),
        isTrue,
      );
    });

    test('offered only to the signed-in learner of an answering server', () {
      final report = SyncReport(courses: {'spanish-spain|en': ServerCourse.fromEnrollment(enrollment())!});
      const user = AccountUser(id: 'u-1', email: 'learner@example.test');
      expect(AccountState(available: true, user: user, lastReport: report).serverCourse('spanish-spain|en')?.enrollmentId, 'enr-1');
      expect(AccountState(available: true, user: user, lastReport: report).serverCourse('japanese|en'), isNull);
      expect(AccountState(available: true, lastReport: report).serverCourse('spanish-spain|en'), isNull, reason: 'signed out');
      expect(
        AccountState(user: user, lastReport: report).serverCourse('spanish-spain|en'),
        isNull,
        reason: 'server not answering',
      );
      expect(AccountState(available: true, user: user, lastReport: report).serverCourse(null), isNull);
    });
  });
}
