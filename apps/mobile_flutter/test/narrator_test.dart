// Reads the content bundle from disk (dart:io): VM only.
@TestOn('vm')
library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:langquest_mobile/core/backend/api_client.dart';
import 'package:langquest_mobile/core/backend/narrator.dart';
import 'package:langquest_mobile/core/audio/clip_player_provider.dart';
import 'package:langquest_mobile/core/backend/server_course.dart';
import 'package:langquest_mobile/core/content/content_source.dart';
import 'package:langquest_mobile/core/services/app_state.dart';
import 'package:langquest_mobile/core/services/learner_state.dart';
import 'package:langquest_mobile/features/learn/learn_content.dart';
import 'package:langquest_mobile/features/learn/learn_logic.dart';
import 'package:langquest_mobile/main.dart';
import 'package:langquest_mobile/navigation/app_router.dart';

import 'call_fakes.dart';
import 'support.dart';

/// Records what it was asked to say; each narration ends at once.
class RecordingNarrator implements Narrator {
  final said = <String>[];
  var stops = 0;

  @override
  bool get ai => true;

  @override
  Future<void> say(String text) async => said.add(text);

  @override
  void prepare(String text) {}

  @override
  void stop() => stops++;
}

const course = ServerCourse(enrollmentId: 'enr-1', targetVarietyId: 'es-ES', speechCheck: true);

http.Response _json(int status, Object body) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json; charset=utf-8'});

Future<void> settle(WidgetTester t, [int ms = 900]) async {
  for (var i = 0; i < ms ~/ 100; i++) {
    await t.pump(const Duration(milliseconds: 100));
  }
}

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  group('the AI narrator', () {
    test('asks the server once per text (in the enrollment\'s instruction language) and plays the clip', () async {
      final sent = <Map<String, Object?>>[];
      final client = MockClient((request) async {
        expect(request.url.path, '/v1/speech/narrate');
        sent.add((jsonDecode(request.body) as Map).cast<String, Object?>());
        return _json(200, {
          'ok': true,
          'data': {
            'audio': {'url': 'https://media.test/narration.mp3', 'base64': null, 'encoding': 'mp3'},
            'capability': <String, Object?>{},
            'language': 'en',
          },
        });
      });
      final player = FakeClipPlayer(instant: true);
      final narrator = ServerNarrator(
        api: LangQuestApi(baseUrl: 'https://api.test', accessToken: () async => 't', client: client),
        course: course,
        player: player,
      );
      await narrator.say('What do you answer?');
      await narrator.say('What do you answer?');
      expect(sent, hasLength(1), reason: 'a clip is fetched once per session');
      expect(sent.single, {'enrollmentId': 'enr-1', 'text': 'What do you answer?', 'speed': 'normal'});
      expect(player.played, ['https://media.test/narration.mp3', 'https://media.test/narration.mp3']);
      expect(narrator.ai, isTrue);
    });

    test('without a narrator voice on the server, nothing is narrated: never the device\'s synthetic voice (and the server is not asked again)', () async {
      var calls = 0;
      final client = MockClient((request) async {
        calls++;
        return _json(501, {
          'ok': false,
          'error': {'code': 'capability_unsupported', 'message': 'No narrator voice'},
        });
      });
      final player = FakeClipPlayer(instant: true);
      final narrator = ServerNarrator(
        api: LangQuestApi(baseUrl: 'https://api.test', accessToken: () async => 't', client: client),
        course: course,
        player: player,
      );
      await narrator.say('At the café.');
      await narrator.say('Pepa says');
      expect(calls, 1);
      expect(player.played, isEmpty);
      expect(narrator.ai, isFalse);
    });

    test('a clip that arrives after a stop is not played', () async {
      final client = MockClient((request) async {
        await Future<void>.delayed(const Duration(milliseconds: 20));
        return _json(200, {
          'ok': true,
          'data': {
            'audio': {'url': 'https://media.test/late.mp3'},
            'capability': <String, Object?>{},
            'language': 'en',
          },
        });
      });
      final player = FakeClipPlayer(instant: true);
      final narrator = ServerNarrator(
        api: LangQuestApi(baseUrl: 'https://api.test', accessToken: () async => 't', client: client),
        course: course,
        player: player,
      );
      final saying = narrator.say('Too late');
      narrator.stop();
      await saying;
      expect(player.played, isEmpty);
    });
  });

  group('the recorded narration', () {
    const location = 'https://bucket.test/c/';
    const recorded = BundledNarration({'At the café.': 'assets/audio/narration/narrator-en-sulafat-0123456789abcdef.mp3'});

    test('a recorded sentence plays its clip from the content bucket; another goes to the server\'s AI narrator', () async {
      final player = FakeClipPlayer(instant: true);
      final server = RecordingNarrator();
      final narrator = BundledNarrator(narration: recorded, player: player, location: ContentLocation(Uri.parse(location)), server: server);
      await narrator.say('At the café.');
      await narrator.say('Pepa says');
      expect(player.played, ['${location}audio/narration/narrator-en-sulafat-0123456789abcdef.mp3']);
      expect(server.said, ['Pepa says']);
      expect(narrator.ai, isTrue);
    });

    test('signed out, a sentence not recorded is not said at all (never by the device\'s synthetic voice)', () async {
      final player = FakeClipPlayer(instant: true);
      final narrator = BundledNarrator(narration: recorded, player: player, location: ContentLocation(Uri.parse(location)));
      await narrator.say('Pepa says');
      expect(player.played, isEmpty);
    });

    test('the narration file maps each sentence to its clip', () {
      final parsed = BundledNarration.parse('{"schemaVersion":1,"clips":{"Comment dit-on « Merci » ?":"assets/audio/narration/x.mp3"}}');
      expect(parsed.clipOf('Comment dit-on « Merci » ?'), 'assets/audio/narration/x.mp3');
      expect(parsed.clipOf('Autre chose'), isNull);
      expect(BundledNarration.asset('arabic-moroccan', 'fr'), 'assets/content/narration/fr/arabic-moroccan.json');
      expect(() => BundledNarration.parse('{"schemaVersion":2}'), throwsFormatException);
    });

    Future<ProviderContainer> signedOut({required bool withRecording}) async {
      Future<String> read(String path) async {
        if (path == BundledNarration.asset('arabic-moroccan', 'fr')) {
          if (!withRecording) throw StateError('no narration recorded yet');
          return '{"schemaVersion":1,"clips":{"Anas dit":"assets/audio/narration/narrator-fr-sulafat-a5e8b0b029f886e3.mp3"}}';
        }
        return readTestAsset(path);
      }

      final container = ProviderContainer(
        overrides: [
          ...await testOverrides(read: read),
          clipPlayerFactoryProvider.overrideWithValue(() => FakeClipPlayer(instant: true)),
        ],
      );
      addTearDown(container.dispose);
      container.read(appStateProvider.notifier).enroll('arabic-moroccan', 'fr');
      container.listen(narratorProvider, (_, _) {});
      await container.read(bundledNarrationProvider(('arabic-moroccan', 'fr')).future);
      return container;
    }

    test('signed out with the course\'s narration recorded, the recorded narrator reads exercises aloud', () async {
      final container = await signedOut(withRecording: true);
      expect(container.read(narratorProvider), isA<BundledNarrator>());
      expect(await container.read(narrationAvailableProvider.future), isTrue);
    });

    test('signed out without a recording, nothing narrates: the device\'s synthetic voice is never the narrator', () async {
      final container = await signedOut(withRecording: false);
      expect(container.read(narratorProvider), isNull);
      expect(await container.read(narrationAvailableProvider.future), isFalse, reason: 'no read-aloud button either');
    });
  });

  test('narration is in the course\'s instruction language (never another one), and the setting is kept', () {
    expect(narrationWords('fr')!.missionWhatDoYouAnswer, 'Que répondez-vous ?');
    expect(narrationWords('en')!.missionWhatDoYouAnswer, 'What do you answer?');
    expect(narrationWords('ja'), isNull);
    expect(const LearnerState().readAloud, isTrue);
    expect(LearnerState.fromJson(const LearnerState(readAloud: false).toJson()).readAloud, isFalse);
  });

  group('a mission read aloud', () {
    const missionKey = 'es_greet_and_introduce';

    Future<(ProviderContainer, RecordingNarrator)> open(WidgetTester t, {required bool readAloud}) async {
      t.view.physicalSize = const Size(390 * 3, 844 * 3);
      t.view.devicePixelRatio = 3;
      addTearDown(t.view.reset);
      final narrator = RecordingNarrator();
      await t.pumpWidget(ProviderScope(overrides: [...await testOverrides(), narratorProvider.overrideWithValue(narrator)], child: const LangQuestApp()));
      final container = ProviderScope.containerOf(t.element(find.byType(LangQuestApp)));
      final notifier = container.read(appStateProvider.notifier)
        ..setReduceMotion(true)
        ..setReadAloud(readAloud);
      notifier.enroll('spanish-spain', 'en');
      notifier.completeStop(missionKey, PathStop.learn);
      notifier.completeStop(missionKey, PathStop.practise);
      container.read(appRouterProvider).go('/mission/$missionKey');
      await settle(t, 1500);
      return (container, narrator);
    }

    testWidgets('the scene\'s context, then who speaks and the question, in the learner\'s language', (t) async {
      final (_, narrator) = await open(t, readAloud: true);
      final mission = testBundle.mission(missionKey)!;
      final plan = buildLearnPlan(mission: mission, track: testBundle.track('spanish-spain')!, source: 'en', character: testBundle.characterOf(mission));
      final first = plan.exchanges.first;
      final question = first.cue == null ? 'How do you say “${plan.promptMeaningOf(first.answer)}”?' : 'What do you answer?';
      expect(narrator.said, [?mission.sceneNoteIn('en'), if (first.cue != null) '${plan.characterName} says', question]);

      // Read aloud again on request.
      narrator.said.clear();
      await t.tap(find.byTooltip('Read aloud').first);
      await settle(t);
      expect(narrator.said.last, question);
    });

    testWidgets('with reading aloud off, nothing is narrated until the learner asks', (t) async {
      final (_, narrator) = await open(t, readAloud: false);
      expect(narrator.said, isEmpty);
      await t.tap(find.byTooltip('Read aloud').first);
      await settle(t);
      expect(narrator.said, isNotEmpty);
    });
  });
}
