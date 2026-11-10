import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:langquest_mobile/core/services/speech_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('flutter_tts');
  final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  /// The engine answers `getVoices` with [answers] in turn (the last one repeats); returns the call log.
  List<String> engineAnswers(List<List<Map<String, String>>> answers) {
    final calls = <String>[];
    var next = 0;
    messenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call.method);
      if (call.method != 'getVoices') return 1;
      return answers[next < answers.length - 1 ? next++ : answers.length - 1];
    });
    return calls;
  }

  int voiceQueries(List<String> calls) => calls.where((c) => c == 'getVoices').length;

  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  test('a voice list that loads late still counts (browsers fill it asynchronously)', () async {
    final calls = engineAnswers([
      [],
      [],
      [
        {'name': 'Mónica', 'locale': 'es-ES'},
      ],
    ]);
    expect(await SpeechService(voiceRetryDelay: Duration.zero).supports('es-ES'), isTrue);
    expect(voiceQueries(calls), 3);
  });

  test('only the exact locale counts: a Mexican voice never speaks for Spain', () async {
    engineAnswers([
      [
        {'name': 'Paulina', 'locale': 'es-MX'},
        {'name': 'Kyoko', 'locale': 'ja_JP'},
      ],
    ]);
    final speech = SpeechService(voiceRetryDelay: Duration.zero);
    expect(await speech.supports('es-ES'), isFalse);
    expect(await speech.supports('ja-JP'), isTrue);
  });

  test('a device without voices answers no after a few tries, and is asked again later', () async {
    final calls = engineAnswers([[]]);
    final speech = SpeechService(voiceRetryDelay: Duration.zero);
    expect(await speech.supports('es-ES'), isFalse);
    expect(voiceQueries(calls), SpeechService.voiceListAttempts);
    expect(await speech.supports('es-ES'), isFalse);
    expect(voiceQueries(calls), 2 * SpeechService.voiceListAttempts);
  });

  test('no speech engine at all: no voice and no waiting', () async {
    // No handler: the channel throws MissingPluginException. A retry would wait a day and time the test out.
    expect(await SpeechService(voiceRetryDelay: const Duration(days: 1)).supports('es-ES'), isFalse);
  });

  test('a course without a voice locale never asks the engine (colloquial Arabic)', () async {
    final calls = engineAnswers([
      [
        {'name': 'Maged', 'locale': 'ar-SA'},
      ],
    ]);
    expect(await SpeechService(voiceRetryDelay: Duration.zero).supports(null), isFalse);
    expect(calls, isEmpty);
  });
}
