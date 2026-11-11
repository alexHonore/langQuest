// A fake of the API's conversation routes and of the clip player, shared by the call tests.
import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:langquest_mobile/core/audio/clip_player.dart';
import 'package:langquest_mobile/features/call/call_portrait.dart';

/// Pablo, as the seed names him (`characters.id` = UUIDv5 of his roster id).
final pabloId = characterServerId('es-es-schoolboy-pablo');

/// The character's reply to one learner turn.
class ScriptedTurn {
  const ScriptedTurn({
    this.heard,
    this.reply,
    this.objectives = const [],
    this.tentative = const [],
    this.noSpeech = false,
    this.inProgressFirst = false,
    this.expression = 'talking',
    this.endsConversation = false,
    this.status,
  });

  /// What the recognizer heard (audio turns), or null for the text as typed.
  final String? heard;
  final String? reply;
  final List<String> objectives;
  final List<String> tentative;
  final bool noSpeech;

  /// Answer 409 `turn_in_progress` once before the reply.
  final bool inProgressFirst;
  final String expression;
  final bool endsConversation;

  /// Answer this HTTP status (an error) instead.
  final int? status;
}

class FakeConversationServer {
  FakeConversationServer({
    this.turns = const [],
    this.startStatus,
    this.gloss = 'Hi! I’m Pablo. What’s your name?',
    this.withAudio = true,
    this.evaluated = true,
    this.describedGoals = true,
  });

  final List<ScriptedTurn> turns;
  final int? startStatus;
  final String? gloss;
  final bool withAudio;
  final bool evaluated;

  /// The mission's goals have a description in the learner's language (seeded missions often have none: '').
  final bool describedGoals;
  final requests = <String>[];
  final bodies = <String, List<Map<String, Object?>>>{};
  var _seq = 1;
  var _turn = 0;

  /// Turns the server credits (said something, or asked for help): none means a silent call (no XP, no corrections).
  var _creditedTurns = 0;
  final _inProgressDone = <String>{};
  final _done = <String>[];

  List<Map<String, Object?>> turnBodies() => bodies.entries.where((e) => e.key.endsWith('/turn')).expand((e) => e.value).toList();

  static http.Response _json(Object? body, [int status = 200]) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});
  static http.Response _error(int status, String code, [Map<String, Object?> details = const {}]) => _json({
    'ok': false,
    'error': {'code': code, 'message': code, 'details': details},
  }, status);

  Map<String, Object?> _session() => {
    'sessionId': '11111111-1111-4111-8111-111111111111',
    'state': 'listening',
    'mode': 'push_to_talk',
    'targetVarietyId': 'es-ES',
    'turnCount': _seq,
    'lastLearnerTurnId': null,
    'lastCharacterTurnId': 'char-$_seq',
    'lastSeq': _seq,
    'objectivesCompleted': [..._done],
    'startedAt': '2026-11-11T10:00:00Z',
    'updatedAt': '2026-11-11T10:00:00Z',
    'endedAt': null,
  };

  Map<String, Object?> _characterTurn(
    String text, {
    String expression = 'talking',
    List<String> tentative = const [],
    bool ends = false,
    String? respondsTo,
    String? gloss,
  }) => {
    'turnId': 'char-$_seq',
    'characterId': pabloId,
    'text': text,
    'transliteration': null,
    'sourceGloss': gloss,
    'expression': expression,
    'respondsToCommand': respondsTo,
    'tentativeObjectiveIds': tentative,
    'audio': withAudio ? {'assetId': null, 'url': 'data:audio/mpeg;base64,AAAA$_seq', 'durationMs': 1800, 'synthetic': true} : null,
    'endsConversation': ends,
    'model': 'test',
    'latencyMs': 900,
  };

  http.Client get client => MockClient((req) async {
    final key = '${req.method} ${req.url.path}';
    requests.add(key);
    if (req.body.isNotEmpty) (bodies[key] ??= []).add((jsonDecode(req.body) as Map).cast<String, Object?>());
    final ok = {'ok': true};
    if (key == 'POST /v1/ai/conversation/session') {
      if (startStatus != null) return _error(startStatus!, startStatus == 501 ? 'capability_unsupported' : 'internal');
      return _json({
        ...ok,
        'data': {
          'session': _session(),
          'provider': {'pipeline': 'stt_llm_tts'},
          'character': {'id': pabloId, 'name': 'Pablo', 'role': 'Schoolboy', 'targetVarietyId': 'es-ES', 'syntheticVoice': true, 'portraitAssetId': null},
          'capabilities': {},
          // A free call (no mission) has no goals.
          'objectives': bodies[key]!.last['missionId'] == null
              ? <Object>[]
              : [
                  {'id': 'greet', 'description': describedGoals ? 'Greet Pablo' : '', 'skillKeys': <String>[]},
                  {'id': 'name', 'description': describedGoals ? 'Say your name' : '', 'skillKeys': <String>[]},
                ],
          'openingTurn': _characterTurn('¡Hola! Soy Pablo. ¿Cómo te llamas?', expression: 'greeting', gloss: gloss),
        },
      }, 201);
    }
    if (key.endsWith('/turn')) {
      final body = bodies[key]!.last;
      final input = body['input'] as Map;
      if (input['kind'] == 'command') {
        _seq += 2;
        _creditedTurns++;
        final command = input['command'] as String;
        return _json({
          ...ok,
          'data': {
            'session': _session(),
            'learnerTranscript': null,
            'characterTurn': _characterTurn(command == 'hint' ? 'Puedes decir: «Me llamo…»' : 'Más despacio: ¿Cómo te llamas?', respondsTo: command),
            'replayed': false,
            'evaluationPending': false,
            'objectivesCompleted': [..._done],
          },
        });
      }
      final script = turns[_turn.clamp(0, turns.length - 1)];
      final id = body['clientTurnId'] as String;
      if (script.inProgressFirst && _inProgressDone.add(id)) return _error(409, 'turn_in_progress', {'retryAfterSeconds': 1});
      if (script.status != null) {
        _turn++;
        return _error(script.status!, script.status == 412 ? 'precondition_failed' : 'internal');
      }
      _turn++;
      if (script.noSpeech) {
        return _json({
          ...ok,
          'data': {
            'session': _session(),
            'learnerTranscript': null,
            'characterTurn': null,
            'replayed': false,
            'evaluationPending': false,
            'objectivesCompleted': [..._done],
            'speech': {'speechDetected': false, 'reason': 'silence'},
          },
        });
      }
      _seq += 2;
      _creditedTurns++;
      _done.addAll(script.objectives);
      final heard = script.heard ?? (input['kind'] == 'text' ? input['text'] : null);
      return _json({
        ...ok,
        'data': {
          'session': _session(),
          'learnerTranscript': heard == null ? null : {'text': heard, 'confidence': 0.9},
          'characterTurn': script.reply == null
              ? null
              : _characterTurn(script.reply!, expression: script.expression, tentative: script.tentative, ends: script.endsConversation),
          'replayed': false,
          'evaluationPending': false,
          'objectivesCompleted': [..._done],
          'speech': {'speechDetected': true, 'reason': null},
        },
      });
    }
    if (key.endsWith('/end')) {
      return _json({
        ...ok,
        'data': {
          'session': _session(),
          'evaluation': {
            'objectivesCompleted': [..._done],
            'skillsExercised': <String>[],
            'observations': <Object>[],
            'priorityCorrections': [
              if (_creditedTurns > 0)
                {
                  'skillKey': null,
                  'learnerUtterance': 'Yo llamo Alex',
                  'suggestedUtterance': 'Me llamo Alex.',
                  'explanation': 'Use “me llamo” to say your name.',
                  'category': 'grammar',
                },
            ],
            'summary': 'You greeted Pablo.',
            'reviewTriggers': <String>[],
            'relationshipMemoryUpdate': null,
            'confidence': evaluated ? 0.8 : null,
          },
          // As the server: XP only for credited turns (a silent call earns nothing).
          'xpAwarded': _creditedTurns > 0 ? 30 : 0,
          'scheduledReviews': <Object>[],
          'summary': 'You greeted Pablo and said your name.',
          'transcriptRetained': false,
        },
      });
    }
    return _error(404, 'not_found');
  });
}

/// Plays nothing: each clip "ends" when [finish] is called (or at once with [instant]).
class FakeClipPlayer implements ClipPlayer {
  FakeClipPlayer({this.instant = false});

  final bool instant;
  final played = <String>[];
  var primed = 0;
  var stops = 0;
  Completer<void>? _playing;
  final _levels = StreamController<double>.broadcast();
  final _progress = StreamController<double>.broadcast();

  bool get playing => _playing != null && !_playing!.isCompleted;

  @override
  void prime() => primed++;

  @override
  Future<void> play(String url) {
    played.add(url);
    _playing = Completer<void>();
    if (instant) _playing!.complete();
    _levels.add(0.6);
    return _playing!.future;
  }

  void finish() {
    if (playing) _playing!.complete();
  }

  @override
  Stream<double> get levels => _levels.stream;

  @override
  Stream<double> get progress => _progress.stream;

  @override
  void stop() {
    stops++;
    finish();
  }

  @override
  void dispose() {
    finish();
    _levels.close();
    _progress.close();
  }
}
