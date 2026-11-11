import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../../core/audio/take_recorder.dart';
import '../../core/audio/wav.dart';
import '../../core/backend/api_client.dart';
import '../../core/backend/curriculum_ids.dart';
import '../../core/backend/server_course.dart';

enum CallPhase {
  /// Not started: the learner taps Call (the session costs model calls, so it never starts by itself).
  idle,

  /// Creating the session; the character's opening line is being written and voiced.
  connecting,
  active,

  /// Hanging up: the server evaluates the conversation.
  ending,
  ended,

  /// The call could not start or went away ([CallSession.failure] says why).
  failed,
}

/// Why a call failed.
enum CallFailure {
  /// The server has no conversation for this course or mission yet (422/501 `unsupported`, 404).
  unavailable,

  /// The network or the server is down; trying again may work.
  network,

  /// The session expired or was ended elsewhere (412).
  ended,
}

/// Something to tell the learner about the last turn (shown briefly, never blocking).
enum CallNotice {
  /// The take held no speech: nothing was sent to the character.
  noSpeech,

  /// The turn did not go through.
  turnFailed,
}

@immutable
class CallCharacter {
  const CallCharacter({required this.id, required this.name, required this.role});

  /// `characters.id`: the UUIDv5 of the art roster id (`call_art.dart`).
  final String id;
  final String name;
  final String role;
}

/// One line of the conversation.
class CallLine {
  CallLine.character({required this.id, required this.text, this.transliteration, this.gloss, this.expression = 'talking', this.audioUrl, this.respondsTo})
    : fromLearner = false,
      pending = false,
      viaVoice = false;

  CallLine.learner({required this.id, this.text, this.pending = false, this.viaVoice = false})
    : fromLearner = true,
      transliteration = null,
      gloss = null,
      expression = 'neutral',
      audioUrl = null,
      respondsTo = null;

  final String id;
  final bool fromLearner;

  /// The learner's line as the server heard it (null while it is being heard).
  String? text;

  /// Waiting for the server (the learner's take is being heard).
  bool pending;

  /// The learner spoke (rather than typed).
  final bool viaVoice;
  final String? transliteration;

  /// The line in the learner's instruction language, when the server wrote one.
  final String? gloss;

  /// The character's stage direction (`greeting`, `confusion`, `friendly_success`…): the portrait shows it.
  final String expression;

  /// The line's synthesized audio (`data:` URL), when the session speaks.
  final String? audioUrl;

  /// The help the line answers (`hint`, `slower`, `translate`…), if any.
  final String? respondsTo;
}

class CallObjective {
  CallObjective({required this.id, required this.description});

  final String id;
  final String description;

  /// The character believes it was just met; the evaluator confirms at the end.
  bool tentative = false;

  /// The server counts it as met.
  bool done = false;
}

@immutable
class CallCorrection {
  const CallCorrection({required this.said, required this.better, required this.why});

  final String said;
  final String better;

  /// In the learner's instruction language.
  final String why;
}

/// What the server made of the conversation when it ended.
@immutable
class CallSummary {
  const CallSummary({
    required this.objectivesMet,
    required this.corrections,
    required this.summary,
    required this.xp,
    required this.reviews,
    required this.evaluated,
  });

  final List<String> objectivesMet;
  final List<CallCorrection> corrections;
  final String summary;
  final int xp;
  final int reviews;

  /// False when no evaluator ran (provider unavailable): nothing is claimed about the learner then.
  final bool evaluated;
}

/// One live conversation with a course character through the API (`/v1/ai/conversation/*`): session, turns, end.
/// The screen plays the character's audio and records the learner; this holds the conversation and talks to the
/// server. Turns are replay-safe: a retry reuses its `clientTurnId`, so the server never answers twice.
class CallSession extends ChangeNotifier {
  CallSession({
    required this.api,
    required this.course,
    this.missionId,
    this.characterId,
    required this.voice,
    String Function()? newId,
    DateTime Function()? now,
  }) : _newId = newId ?? randomUuid,
       _now = now ?? DateTime.now;

  final LangQuestApi api;
  final ServerCourse course;

  /// The server mission the call practises (its objectives and scene); null for a free conversation.
  final String? missionId;

  /// The character called (`characters.id`); null lets the server pick the mission's.
  final String? characterId;

  /// Spoken (push to talk, the character's voice) or written only.
  final bool voice;
  final String Function() _newId;
  final DateTime Function() _now;

  CallPhase phase = CallPhase.idle;
  CallFailure? failure;
  CallCharacter? character;
  final objectives = <CallObjective>[];
  final lines = <CallLine>[];

  /// The character is answering.
  bool thinking = false;
  CallNotice? notice;
  DateTime? connectedAt;
  CallSummary? summary;

  String? _sessionId;
  int _lastSeq = 0;
  int _turnCount = 0;
  String? _lastCharacterTurnId;
  bool _characterEnded = false;
  bool _disposed = false;

  /// The learner's lines the server heard.
  int get learnerTurns => lines.where((l) => l.fromLearner && !l.pending && l.text != null).length;

  /// The character's latest line.
  CallLine? get lastCharacterLine {
    for (final line in lines.reversed) {
      if (!line.fromLearner) return line;
    }
    return null;
  }

  /// The character said goodbye: the call can end.
  bool get characterEnded => _characterEnded;

  bool get allObjectivesMet => objectives.isNotEmpty && objectives.every((o) => o.done || o.tentative);

  void _changed() {
    if (!_disposed) notifyListeners();
  }

  /// Calls: the session and the character's opening line (returned, to be played).
  Future<CallLine?> start() async {
    if (phase == CallPhase.connecting || phase == CallPhase.active) return null;
    phase = CallPhase.connecting;
    failure = null;
    _changed();
    final Map<String, Object?> data;
    try {
      data = await api.startConversation(
        enrollmentId: course.enrollmentId,
        clientSessionId: _newId(),
        missionId: missionId,
        characterId: characterId,
        voice: voice,
      );
    } on ApiException catch (e) {
      phase = CallPhase.failed;
      // 501 `capability_unsupported` says the course has no conversation yet: not something a retry fixes.
      failure = e.isTransient && e.code != 'capability_unsupported' ? CallFailure.network : CallFailure.unavailable;
      _changed();
      return null;
    }
    final session = _map(data['session']);
    _sessionId = session['sessionId'] as String?;
    _readState(session);
    final who = _map(data['character']);
    character = CallCharacter(id: '${who['id']}', name: '${who['name'] ?? ''}', role: '${who['role'] ?? ''}');
    objectives
      ..clear()
      ..addAll([
        for (final o in (data['objectives'] as List? ?? const []))
          if (o is Map) CallObjective(id: '${o['id']}', description: '${o['description'] ?? ''}'),
      ]);
    if (_sessionId == null) {
      phase = CallPhase.failed;
      failure = CallFailure.unavailable;
      _changed();
      return null;
    }
    phase = CallPhase.active;
    connectedAt = _now();
    final opening = data['openingTurn'] is Map ? _characterLine(_map(data['openingTurn'])) : null;
    if (opening != null) lines.add(opening);
    _changed();
    return opening;
  }

  /// The learner's spoken turn; returns the character's reply (to be played), or null.
  Future<CallLine?> sendTake(RecordedTake take, {bool bargeIn = false}) async {
    if (!_canTurn) return null;
    final encodingOk = apiEncodingFor(take.mimeType) != null;
    final bytes = encodingOk ? await take.bytes() : null;
    if (bytes == null || bytes.isEmpty) {
      notice = CallNotice.turnFailed;
      _changed();
      return null;
    }
    final mine = CallLine.learner(id: _newId(), pending: true, viaVoice: true);
    final ms = take.duration.inMilliseconds;
    return _turn(mine, {
      'input': {'kind': 'audio', 'assetId': _newId(), 'durationMs': ms, 'transcriptHint': null},
      'audio': {'base64': base64Encode(bytes), 'mime': take.mimeType, 'durationMs': ms},
      'recording': {'peakLevelDb': take.peakLevelDb},
      'bargeIn': bargeIn,
    });
  }

  /// The learner's written turn.
  Future<CallLine?> sendText(String text) async {
    final trimmed = text.trim();
    if (!_canTurn || trimmed.isEmpty) return null;
    return _turn(CallLine.learner(id: _newId(), text: trimmed), {
      'input': {'kind': 'text', 'text': trimmed},
    });
  }

  /// Asks the character for help (`hint`, `repeat`, `slower`, `translate`, `example`, `meaning`, `skip`).
  Future<CallLine?> sendCommand(String command) async {
    if (!_canTurn) return null;
    return _turn(null, {
      'input': {'kind': 'command', 'command': command},
    });
  }

  bool get _canTurn => phase == CallPhase.active && !thinking && _sessionId != null;

  Future<CallLine?> _turn(CallLine? mine, Map<String, Object?> body) async {
    thinking = true;
    notice = null;
    if (mine != null) lines.add(mine);
    _changed();
    final request = {
      'clientTurnId': _newId(),
      ...body,
      'clientState': {'state': 'listening', 'lastSeq': _lastSeq, 'lastCharacterTurnId': _lastCharacterTurnId},
    };
    Map<String, Object?>? data;
    try {
      data = await _send(request);
    } on ApiException catch (e) {
      if (mine != null) lines.remove(mine);
      thinking = false;
      if (e.status == 412) {
        phase = CallPhase.failed;
        failure = CallFailure.ended;
      } else {
        notice = CallNotice.turnFailed;
      }
      _changed();
      return null;
    }
    thinking = false;
    _readState(_map(data['session']));
    final speech = _map(data['speech']);
    if (speech['speechDetected'] == false) {
      // Nothing was heard: no learner line, no reply, nothing sent to the character.
      if (mine != null) lines.remove(mine);
      notice = CallNotice.noSpeech;
      _changed();
      return null;
    }
    final heard = _map(data['learnerTranscript'])['text'];
    if (mine != null) {
      mine
        ..text = heard is String && heard.trim().isNotEmpty ? heard.trim() : mine.text
        ..pending = false;
      if (mine.text == null) lines.remove(mine);
    }
    _markObjectives(data['objectivesCompleted'], done: true);
    final reply = data['characterTurn'] is Map ? _characterLine(_map(data['characterTurn'])) : null;
    if (reply != null) lines.add(reply);
    _changed();
    return reply;
  }

  /// One turn request; a turn still in flight on the server (409) or a dropped connection is retried with the same
  /// `clientTurnId`, which the server answers with the one reply it made.
  Future<Map<String, Object?>> _send(Map<String, Object?> request) async {
    for (var attempt = 0; ; attempt++) {
      try {
        return await api.conversationTurn(_sessionId!, request);
      } on ApiException catch (e) {
        final inFlight = e.code == 'turn_in_progress' && attempt < 4;
        final dropped = e.status == 0 && attempt < 1;
        if (!inFlight && !dropped) rethrow;
        final wait = (e.details['retryAfterSeconds'] as num?)?.toInt() ?? 2;
        await Future<void>.delayed(Duration(seconds: wait.clamp(1, 10)));
      }
    }
  }

  /// Hangs up; the server's evaluation of the conversation becomes [summary].
  Future<void> hangUp() async {
    final id = _sessionId;
    if (phase != CallPhase.active || id == null) {
      if (phase == CallPhase.connecting || phase == CallPhase.idle || phase == CallPhase.failed) {
        phase = CallPhase.ended;
        _changed();
      }
      return;
    }
    phase = CallPhase.ending;
    _changed();
    try {
      final data = await api.endConversation(
        id,
        reason: _characterEnded || allObjectivesMet ? 'completed' : 'learner_ended',
        lastSeq: _lastSeq,
        turnCount: _turnCount,
        clientEventId: _newId(),
      );
      final evaluation = _map(data['evaluation']);
      final met = [for (final o in (evaluation['objectivesCompleted'] as List? ?? const [])) '$o'];
      _markObjectives(met, done: true);
      summary = CallSummary(
        objectivesMet: met,
        corrections: [
          for (final c in (evaluation['priorityCorrections'] as List? ?? const []))
            if (c is Map) CallCorrection(said: '${c['learnerUtterance'] ?? ''}', better: '${c['suggestedUtterance'] ?? ''}', why: '${c['explanation'] ?? ''}'),
        ],
        summary: '${data['summary'] ?? evaluation['summary'] ?? ''}'.trim(),
        xp: (data['xpAwarded'] as num?)?.toInt() ?? 0,
        reviews: (data['scheduledReviews'] as List?)?.length ?? 0,
        evaluated: evaluation['confidence'] != null,
      );
    } on ApiException {
      // The call is over either way; without the server's evaluation nothing is claimed.
      summary = null;
    }
    phase = CallPhase.ended;
    _changed();
  }

  /// Leaving without hanging up: the server is told, without waiting for its evaluation.
  void abandon() {
    final id = _sessionId;
    if (phase != CallPhase.active || id == null) return;
    phase = CallPhase.ended;
    unawaited(api.endConversation(id, reason: 'abandoned', lastSeq: _lastSeq, turnCount: _turnCount, clientEventId: _newId()).then((_) {}, onError: (_) {}));
  }

  void clearNotice() {
    if (notice == null) return;
    notice = null;
    _changed();
  }

  void _readState(Map<String, Object?> session) {
    _lastSeq = (session['lastSeq'] as num?)?.toInt() ?? _lastSeq;
    _turnCount = (session['turnCount'] as num?)?.toInt() ?? _turnCount;
    _lastCharacterTurnId = session['lastCharacterTurnId'] as String? ?? _lastCharacterTurnId;
    _markObjectives(session['objectivesCompleted'], done: true);
  }

  void _markObjectives(Object? ids, {required bool done}) {
    if (ids is! List) return;
    for (final o in objectives) {
      if (!ids.contains(o.id)) continue;
      if (done) {
        o.done = true;
      } else {
        o.tentative = true;
      }
    }
  }

  CallLine? _characterLine(Map<String, Object?> turn) {
    final text = turn['text'];
    if (text is! String || text.trim().isEmpty) return null;
    _markObjectives(turn['tentativeObjectiveIds'], done: false);
    if (turn['endsConversation'] == true) _characterEnded = true;
    final audio = _map(turn['audio']);
    // A `data:audio/wav` URL holding raw PCM (Darija's voice) gets its WAV header, or the browser plays nothing.
    final url = audio['url'] is String ? playableTurnAudio(audio['url'] as String, durationMs: (audio['durationMs'] as num?)?.toInt()) : null;
    String? optional(Object? v) => v is String && v.trim().isNotEmpty ? v.trim() : null;
    return CallLine.character(
      id: '${turn['turnId'] ?? _newId()}',
      text: text.trim(),
      transliteration: optional(turn['transliteration']),
      gloss: optional(turn['sourceGloss']),
      expression: optional(turn['expression']) ?? 'talking',
      audioUrl: voice && url is String && url.isNotEmpty ? url : null,
      respondsTo: optional(turn['respondsToCommand']),
    );
  }

  static Map<String, Object?> _map(Object? v) => v is Map ? v.cast<String, Object?>() : const {};

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
