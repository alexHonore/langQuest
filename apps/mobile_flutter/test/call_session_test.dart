import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:langquest_mobile/core/backend/api_client.dart';
import 'package:langquest_mobile/core/backend/server_course.dart';
import 'package:flutter/painting.dart' show TextDirection;
import 'package:langquest_mobile/features/call/call_portrait.dart';
import 'package:langquest_mobile/features/call/call_screen.dart' show directionOf;
import 'package:langquest_mobile/features/call/call_session.dart';
import 'package:langquest_mobile/features/scenes/scene_models.dart';

import 'call_fakes.dart';
import 'recording_fakes.dart';
import 'support.dart';

const course = ServerCourse(enrollmentId: 'enr-1', targetVarietyId: 'es-ES', speechCheck: true, liveConversation: true, voiceConversation: true);
const missionId = '4e4a1d03-3dd3-5585-82c9-7c148a551e9e';

void main() {
  var ids = 0;
  String newId() => '00000000-0000-4000-8000-${(++ids).toString().padLeft(12, '0')}';

  CallSession sessionWith(FakeConversationServer server, {bool voice = true}) => CallSession(
    api: LangQuestApi(baseUrl: 'https://api.test', accessToken: () async => 't', client: server.client),
    course: course,
    missionId: missionId,
    voice: voice,
    newId: newId,
  );

  test('a call starts with the mission\'s character, goals and opening line', () async {
    final server = FakeConversationServer();
    final call = sessionWith(server);
    final opening = await call.start();
    expect(call.phase, CallPhase.active);
    expect(server.bodies['POST /v1/ai/conversation/session']!.single, {
      'enrollmentId': 'enr-1',
      'missionId': missionId,
      'clientSessionId': '00000000-0000-4000-8000-000000000001',
      'mode': 'push_to_talk',
      'inputEncoding': 'webm_opus',
    });
    expect((call.character!.name, call.character!.role), ('Pablo', 'Schoolboy'));
    expect(rosterIdFor(call.character!.id), 'es-es-schoolboy-pablo', reason: 'his portrait ships with the app');
    expect([for (final o in call.objectives) o.description], ['Greet Pablo', 'Say your name']);
    expect(opening!.text, '¡Hola! Soy Pablo. ¿Cómo te llamas?');
    expect(opening.expression, 'greeting');
    expect(opening.gloss, 'Hi! I’m Pablo. What’s your name?');
    expect(opening.audioUrl, startsWith('data:audio/mpeg;base64,'));
    expect(call.lines, [opening]);
  });

  test('a written call asks for text only and plays nothing', () async {
    final server = FakeConversationServer();
    final call = sessionWith(server, voice: false);
    final opening = await call.start();
    expect(server.bodies['POST /v1/ai/conversation/session']!.single['mode'], 'text_only');
    expect(opening!.audioUrl, isNull);
  });

  test('a spoken turn: the take goes inline; the server\'s transcript, the reply and the goals come back', () async {
    final server = FakeConversationServer(
      turns: [
        const ScriptedTurn(
          heard: 'Hola, me llamo Alex',
          reply: '¡Encantado, Alex!',
          objectives: ['greet'],
          tentative: ['name'],
          expression: 'friendly_success',
        ),
      ],
    );
    final call = sessionWith(server);
    await call.start();
    final reply = await call.sendTake(FakeTake(duration: const Duration(milliseconds: 2300), peakLevelDb: -9));
    final body = server.turnBodies().single;
    expect(body['input'], {'kind': 'audio', 'assetId': isA<String>(), 'durationMs': 2300, 'transcriptHint': null});
    expect(body['audio'], {
      'base64': base64Encode(const [26, 69, 223, 163]),
      'mime': 'audio/webm;codecs=opus',
      'durationMs': 2300,
    });
    expect(body['recording'], {'peakLevelDb': -9.0});
    expect(body['clientState'], {'state': 'listening', 'lastSeq': 1, 'lastCharacterTurnId': 'char-1'});
    expect(body['bargeIn'], false);
    expect(reply!.text, '¡Encantado, Alex!');
    expect(reply.expression, 'friendly_success');
    final mine = call.lines[1];
    expect((mine.fromLearner, mine.text, mine.pending, mine.viaVoice), (true, 'Hola, me llamo Alex', false, true));
    expect(call.objectives.first.done, isTrue);
    expect((call.objectives.last.done, call.objectives.last.tentative), (false, true), reason: 'the character thinks so; the evaluator confirms at the end');
    expect(call.learnerTurns, 1);
  });

  test('a take without speech: no line, nothing for the character, a notice', () async {
    final server = FakeConversationServer(turns: [const ScriptedTurn(noSpeech: true)]);
    final call = sessionWith(server);
    await call.start();
    expect(await call.sendTake(FakeTake()), isNull);
    expect(call.lines, hasLength(1));
    expect(call.notice, CallNotice.noSpeech);
    expect(call.learnerTurns, 0);
  });

  test('a turn still in flight on the server is retried with the same id', () async {
    final server = FakeConversationServer(turns: [const ScriptedTurn(reply: 'Vale.', inProgressFirst: true)]);
    final call = sessionWith(server);
    await call.start();
    final reply = await call.sendText('Hola');
    expect(reply!.text, 'Vale.');
    final sent = server.turnBodies();
    expect(sent, hasLength(2));
    expect(sent.first['clientTurnId'], sent.last['clientTurnId']);
  });

  test('help: a hint is a command turn, with no learner line', () async {
    final server = FakeConversationServer();
    final call = sessionWith(server);
    await call.start();
    final reply = await call.sendCommand('hint');
    expect(server.turnBodies().single['input'], {'kind': 'command', 'command': 'hint'});
    expect(reply!.respondsTo, 'hint');
    expect(call.lines.where((l) => l.fromLearner), isEmpty);
  });

  test('translate: the last line in the learner\'s language, under that line (asked only when the server wrote none)', () async {
    final server = FakeConversationServer(turns: [const ScriptedTurn(reply: 'Vale.')]);
    final call = sessionWith(server);
    final opening = await call.start();
    // The opening line came with its translation: shown, nothing asked.
    expect(await call.translateLast(), isTrue);
    expect(opening!.translationShown, isTrue);
    expect(server.turnBodies(), isEmpty);
    await call.sendText('Hola, me llamo Alex');
    final reply = call.lastCharacterLine!;
    expect(reply.gloss, isNull);
    final before = call.lines.length;
    expect(await call.translateLast(), isTrue);
    expect(server.turnBodies().last['input'], {'kind': 'command', 'command': 'translate'});
    expect((reply.gloss, reply.translationShown), ('Okay.', true));
    expect(call.lines, hasLength(before), reason: 'attached to the line, not said again as a new one');
  });

  test('hanging up: the server\'s evaluation, corrections and XP', () async {
    final server = FakeConversationServer(
      turns: [
        const ScriptedTurn(reply: 'Vale.', objectives: ['greet']),
      ],
    );
    final call = sessionWith(server);
    await call.start();
    await call.sendText('Hola, yo llamo Alex');
    await call.hangUp();
    expect(call.phase, CallPhase.ended);
    final end = server.bodies.entries.firstWhere((e) => e.key.endsWith('/end')).value.single;
    expect(end['reason'], 'learner_ended', reason: 'a goal is still open');
    expect(end['clientState'], {'lastSeq': 3, 'turnCount': 3});
    final summary = call.summary!;
    expect(summary.objectivesMet, ['greet']);
    expect(summary.xp, 30);
    expect(summary.evaluated, isTrue);
    expect(summary.summary, 'You greeted Pablo and said your name.');
    expect((summary.corrections.single.said, summary.corrections.single.better), ('Yo llamo Alex', 'Me llamo Alex.'));
  });

  test('every goal met (or the character said goodbye): the call ends as completed', () async {
    final server = FakeConversationServer(
      turns: [
        const ScriptedTurn(reply: '¡Adiós!', objectives: ['greet', 'name'], endsConversation: true),
      ],
    );
    final call = sessionWith(server);
    await call.start();
    await call.sendText('Me llamo Alex. ¡Adiós!');
    expect(call.characterEnded, isTrue);
    await call.hangUp();
    expect(server.bodies.entries.firstWhere((e) => e.key.endsWith('/end')).value.single['reason'], 'completed');
  });

  test('no evaluator ran: nothing is claimed', () async {
    final server = FakeConversationServer(evaluated: false);
    final call = sessionWith(server);
    await call.start();
    await call.hangUp();
    expect(call.summary!.evaluated, isFalse);
  });

  test('failures: unavailable course, network trouble, an expired session', () async {
    final unsupported = sessionWith(FakeConversationServer(startStatus: 501));
    await unsupported.start();
    expect((unsupported.phase, unsupported.failure), (CallPhase.failed, CallFailure.unavailable));

    final down = sessionWith(FakeConversationServer(startStatus: 503));
    await down.start();
    expect((down.phase, down.failure), (CallPhase.failed, CallFailure.network));

    final expired = sessionWith(FakeConversationServer(turns: [const ScriptedTurn(status: 412)]));
    await expired.start();
    await expired.sendText('Hola');
    expect((expired.phase, expired.failure), (CallPhase.failed, CallFailure.ended));

    final flaky = sessionWith(FakeConversationServer(turns: [const ScriptedTurn(status: 500)]));
    await flaky.start();
    expect(await flaky.sendText('Hola'), isNull);
    expect((flaky.phase, flaky.notice), (CallPhase.active, CallNotice.turnFailed), reason: 'one failed turn does not end the call');
    expect(flaky.lines.where((l) => l.fromLearner), isEmpty);
  });

  test('every roster portrait maps to its seeded character id', () {
    // From supabase/migrations/…_140_seed_cast_v2.sql.
    expect(characterServerId('es-es-schoolboy-pablo'), 'c9355db1-008a-565f-8e58-63652cfc47ca');
    expect(rosterIdFor('c9355db1-008a-565f-8e58-63652cfc47ca'), 'es-es-schoolboy-pablo');
    expect(rosterIdFor('00000000-0000-4000-8000-000000000000'), isNull);
    expect(portraitAsset('es-es-schoolboy-pablo', 'confusion'), 'assets/characters/es-es-schoolboy-pablo.confusion.svg');
    expect(portraitAsset('es-es-schoolboy-pablo', 'shrug'), 'assets/characters/es-es-schoolboy-pablo.neutral.svg', reason: 'an unknown expression falls back');
  });

  test('a free call happens where the character works or lives, when their role says so', () {
    expect(sceneForRoster('ary-cafe-staff-nadia'), SceneId.cafe);
    expect(sceneForRoster('ary-neighbour-youssef'), SceneId.home);
    expect(sceneForRoster('es-es-coworker-marta'), SceneId.office);
    expect(sceneForRoster('es-es-retired-bus-driver-antonio'), SceneId.transit);
    expect(sceneForRoster('ja-retired-stationmaster-kenji'), SceneId.station);
    expect(sceneForRoster('en-retired-postwoman-margaret'), SceneId.street);
    expect(sceneForRoster('es-es-schoolboy-pablo'), isNull, reason: 'no one place: the next mission\'s scene');
    expect(sceneForRoster('ary-student-omar'), isNull);
    for (final r in portraitRoster.where((r) => sceneForRoster(r) == null)) {
      expect(r, matches(RegExp(r'-(schoolboy|schoolgirl|student)-')), reason: 'every other role has a place');
    }
  });

  test('a character\'s role in the interface language: the bundle\'s translation, else the server\'s', () {
    expect(testBundle.roleOf('ary-cafe-staff-nadia', 'fr'), 'Employée de café');
    expect(roleIn(testBundle, characterServerId('ja-neighbour-haruka'), 'Neighbour', 'fr'), 'Voisine', reason: 'gendered: Haruka');
    expect(roleIn(testBundle, characterServerId('ary-neighbour-youssef'), 'Neighbour', 'fr'), 'Voisin');
    expect(roleIn(testBundle, characterServerId('es-es-schoolboy-pablo'), 'Schoolboy', 'en'), 'Schoolboy');
    expect(
      roleIn(testBundle, '00000000-0000-4000-8000-000000000000', 'Market vendor', 'fr'),
      'Market vendor',
      reason: 'no portrait, no translation: the server\'s',
    );
    for (final r in portraitRoster) {
      expect(testBundle.roleOf(r, 'fr'), isNotNull, reason: 'every shipped portrait has a French role: $r');
    }
  });

  test('a line runs right to left when it is Arabic script; Arabizi and English stay left to right', () {
    expect(directionOf('وعليكم السلام! لاباس عليك؟'), TextDirection.rtl);
    expect(directionOf('w 3alaykum salam! labas 3lik?'), TextDirection.ltr);
    expect(directionOf('Hola, buenos días.'), TextDirection.ltr);
  });

  test('a turn\'s raw-PCM audio (Darija\'s voice) is made playable', () async {
    final server = FakeConversationServer();
    final call = sessionWith(server);
    final opening = await call.start();
    expect(opening!.audioUrl, startsWith('data:audio/mpeg'), reason: 'mp3 stays as it is');
  });
}
