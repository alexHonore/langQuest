import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

/// An answer of the API that is not `{ok: true}`: [status] is the HTTP status, [code] the API's error code
/// (`conflict`, `validation_failed`, `unauthorized`, `provider_unavailable`…).
class ApiException implements Exception {
  ApiException(this.status, this.code, this.message, [this.details = const {}]);

  final int status;
  final String code;
  final String message;

  /// The error's `details` (for instance `retryAfterSeconds` of a turn still in progress).
  final Map<String, Object?> details;

  /// Worth retrying later (network trouble, rate limit, server down) rather than a request the server refuses.
  bool get isTransient => status == 0 || status == 408 || status == 429 || status >= 500;

  @override
  String toString() => 'ApiException($status $code: $message)';
}

/// The learner routes of the LangQuest API Worker (`apps/api`, contracts in `packages/contracts`) this app uses.
/// Every answer is `{ok: true, data}` or `{ok: false, error: {code, message}}`; the learner's Supabase access token
/// goes in `Authorization: Bearer`.
class LangQuestApi {
  LangQuestApi({required this.baseUrl, required this.accessToken, http.Client? client}) : _client = client ?? http.Client();

  final String baseUrl;
  final Future<String?> Function() accessToken;
  final http.Client _client;

  static String get _platform => kIsWeb ? 'flutter-web' : 'flutter-${defaultTargetPlatform.name}';

  /// Whether the API is up and configured (`/healthz` answers 503 until the Worker has its secrets).
  Future<bool> isHealthy() async {
    try {
      final res = await _client.get(Uri.parse('$baseUrl/healthz')).timeout(const Duration(seconds: 8));
      return res.statusCode == 200 && (jsonDecode(res.body) as Map)['ok'] == true;
    } catch (_) {
      return false;
    }
  }

  Future<Map<String, Object?>> me() async => _object(await _send('GET', '/v1/me'));

  /// `GET /v1/me/skills?enrollmentId=` — the server's mastery estimate of each skill it has evidence for, from speech
  /// checks, missions and calls. Follows the cursor (pages of 200) so every skill comes back.
  Future<List<Map<String, Object?>>> skills(String enrollmentId) async {
    final items = <Map<String, Object?>>[];
    String? cursor;
    do {
      final page = _object(
        await _send('GET', '/v1/me/skills?enrollmentId=$enrollmentId&limit=200${cursor == null ? '' : '&cursor=${Uri.encodeQueryComponent(cursor)}'}'),
      );
      for (final i in (page['items'] as List? ?? const [])) {
        if (i is Map) items.add(i.cast<String, Object?>());
      }
      cursor = page['nextCursor'] as String?;
    } while (cursor != null && items.length < 1000);
    return items;
  }

  /// `GET /v1/courses?source=` (public): every track with what the server offers it from that instruction language —
  /// characters, published audio lessons, and its speech capabilities (recognition, synthesis, conversation, scoring).
  Future<List<Map<String, Object?>>> courses(String source) async {
    final data = _object(await _send('GET', '/v1/courses?source=$source'));
    return [
      for (final c in (data['courses'] as List? ?? const []))
        if (c is Map) c.cast<String, Object?>(),
    ];
  }

  /// `POST /v1/me/enrollments` — 409 `conflict` when the track already has an active enrollment.
  Future<Map<String, Object?>> createEnrollment(String trackId, String source) async =>
      _object(await _send('POST', '/v1/me/enrollments', {'courseTrackId': trackId, 'sourceLanguageCode': source}));

  Future<Map<String, Object?>> missionDetail(String missionId, {required String source, required String enrollmentId}) async =>
      _object(await _send('GET', '/v1/missions/$missionId?source=$source&enrollmentId=$enrollmentId'));

  /// `POST /v1/missions/:id/attempts` — idempotent on [clientAttemptId]; returns the server attempt id.
  Future<String> startAttempt(
    String missionId, {
    required String enrollmentId,
    required String clientAttemptId,
    required int missionRevision,
    required DateTime startedAt,
  }) async {
    final data = _object(
      await _send('POST', '/v1/missions/$missionId/attempts', {
        'enrollmentId': enrollmentId,
        'clientAttemptId': clientAttemptId,
        'missionRevision': missionRevision,
        'startedAt': startedAt.toUtc().toIso8601String(),
      }),
    );
    return data['attemptId'] as String;
  }

  /// `POST /v1/missions/:id/evaluate`. Step outcomes are claims: the server credits XP and review cards only for
  /// steps it holds evidence for; without it the mission completes for navigation (the path) only.
  Future<Map<String, Object?>> evaluate(
    String missionId, {
    required String attemptId,
    required String enrollmentId,
    required DateTime completedAt,
    required String clientEventId,
    required List<Map<String, Object?>> stepResults,
  }) async => _object(
    await _send('POST', '/v1/missions/$missionId/evaluate', {
      'attemptId': attemptId,
      'enrollmentId': enrollmentId,
      'completedAt': completedAt.toUtc().toIso8601String(),
      'clientEventId': clientEventId,
      'stepResults': stepResults,
    }),
  );

  /// `POST /v1/speech/pronunciation-assess` — did the take say [expressionId] (a published expression of the
  /// enrollment's variety)? With [scenarioId] = the mission's id, the server's grading row is evidence for that
  /// mission's speaking steps. A take without speech answers `no_speech_detected` and is never judged.
  Future<Map<String, Object?>> assessSpeech({
    required String enrollmentId,
    required String targetVarietyId,
    required String expressionId,
    required String audioBase64,
    required String encoding,
    required String clientRequestId,
    String? scenarioId,
    double? peakLevelDb,
  }) async => _object(
    await _send('POST', '/v1/speech/pronunciation-assess', {
      'enrollmentId': enrollmentId,
      'targetVarietyId': targetVarietyId,
      'expressionId': expressionId,
      'audio': {'source': 'inline', 'base64': audioBase64, 'encoding': encoding, 'sampleRateHz': null},
      'clientRequestId': clientRequestId,
      'scenarioId': ?scenarioId,
      'recording': {'peakLevelDb': peakLevelDb},
    }, aiTimeout),
  );

  /// `POST /v1/speech/pronunciation-feedback` — AI pronunciation feedback: a listening model's estimate of how the take
  /// (WAV, base64) of [expressionId] (a server id) sounds. Never an acoustic score; not counted as mastery.
  Future<Map<String, Object?>> pronunciationFeedback({
    required String enrollmentId,
    required String targetVarietyId,
    required String expressionId,
    required String wavBase64,
    required String clientRequestId,
    double? peakLevelDb,
  }) async => _object(
    await _send('POST', '/v1/speech/pronunciation-feedback', {
      'enrollmentId': enrollmentId,
      'targetVarietyId': targetVarietyId,
      'expressionId': expressionId,
      'audio': {'source': 'inline', 'base64': wavBase64, 'encoding': 'wav', 'sampleRateHz': 16000},
      'recording': {'peakLevelDb': peakLevelDb},
      'clientRequestId': clientRequestId,
    }, aiTimeout),
  );

  /// `POST /v1/speech/synthesize` — the server's synthetic voice for an approved line of the enrollment's variety
  /// ([expressionId], a server id). The audio comes inline (`base64`) or as a short-lived `url`.
  Future<Map<String, Object?>> synthesize({
    required String enrollmentId,
    required String targetVarietyId,
    required String expressionId,
    bool slow = false,
  }) async => _object(
    await _send('POST', '/v1/speech/synthesize', {
      'enrollmentId': enrollmentId,
      'targetVarietyId': targetVarietyId,
      'expressionId': expressionId,
      'speed': slow ? 'slow' : 'normal',
      'outputEncoding': 'mp3',
    }, aiTimeout),
  );

  /// `GET /v1/admin/models` (admin): the model routes in effect, the defaults, the router's models and the voices.
  Future<Map<String, Object?>> adminModels() async => _object(await _send('GET', '/v1/admin/models', null, aiTimeout));

  /// `PUT /v1/admin/models/:task/config` (admin): saves a task's route after its smoke tests pass.
  Future<Map<String, Object?>> adminModelConfig(String task, Map<String, Object?> body) async =>
      _object(await _send('PUT', '/v1/admin/models/$task/config', body, aiTimeout));

  /// `POST /v1/speech/narrate` — an exercise's instruction or context read aloud in the enrollment's instruction
  /// language (never target-language content: that is [synthesize], by approved expression id).
  Future<Map<String, Object?>> narrate({required String enrollmentId, required String text, bool slow = false}) async =>
      _object(await _send('POST', '/v1/speech/narrate', {'enrollmentId': enrollmentId, 'text': text, 'speed': slow ? 'slow' : 'normal'}, aiTimeout));

  /// `POST /v1/ai/conversation/session` — a live conversation with one of the course's characters, scoped to a
  /// mission (its objectives and scene). Idempotent on [clientSessionId]. The answer names the character, the
  /// objectives and the character's opening line (with its synthesized audio when the session speaks).
  Future<Map<String, Object?>> startConversation({
    required String enrollmentId,
    required String clientSessionId,
    String? missionId,
    String? characterId,
    required bool voice,
  }) async => _object(
    await _send('POST', '/v1/ai/conversation/session', {
      'enrollmentId': enrollmentId,
      'missionId': ?missionId,
      'characterId': ?characterId,
      'clientSessionId': clientSessionId,
      'mode': voice ? 'push_to_talk' : 'text_only',
      'inputEncoding': 'webm_opus',
    }, aiTimeout),
  );

  /// `GET /v1/courses/:trackId/manifest?source=` — the course's published content as the server holds it: its
  /// `characters` (id, name, role: who can be called) and its chapters' missions (which can be called about).
  Future<Map<String, Object?>> courseManifest(String trackId, String source) async =>
      _object(await _send('GET', '/v1/courses/$trackId/manifest?source=$source'));

  /// The course's characters from its manifest ([courseManifest]).
  Future<List<Map<String, Object?>>> courseCharacters(String trackId, String source) async => manifestCharacters(await courseManifest(trackId, source));

  static List<Map<String, Object?>> manifestCharacters(Map<String, Object?> manifest) => [
    for (final c in (manifest['characters'] as List? ?? const []))
      if (c is Map) c.cast<String, Object?>(),
  ];

  /// The ids of the missions a manifest lists, or null when it lists no chapters (an older server: nothing known).
  static Set<String>? manifestMissionIds(Map<String, Object?> manifest) {
    final chapters = manifest['chapters'];
    if (chapters is! List || chapters.isEmpty) return null;
    return {
      for (final c in chapters)
        if (c is Map)
          for (final m in (c['missions'] as List? ?? const []))
            if (m is Map && m['id'] is String) m['id'] as String,
    };
  }

  /// `POST /v1/ai/conversation/:id/turn` — the learner's turn (audio, text or a command) and the character's reply.
  /// Idempotent on `clientTurnId`: a retry with the same id replays the reply; one still in flight answers 409
  /// `turn_in_progress` (retry the same id shortly).
  Future<Map<String, Object?>> conversationTurn(String sessionId, Map<String, Object?> body) async =>
      _object(await _send('POST', '/v1/ai/conversation/$sessionId/turn', body, aiTimeout));

  /// `POST /v1/ai/conversation/:id/end` — hangs up: the server evaluates the conversation (objectives met, up to two
  /// corrections, a summary), awards XP and schedules reviews. Replaying an ended session shows its stored outcome.
  Future<Map<String, Object?>> endConversation(
    String sessionId, {
    required String reason,
    required int lastSeq,
    required int turnCount,
    required String clientEventId,
  }) async => _object(
    await _send('POST', '/v1/ai/conversation/$sessionId/end', {
      'reason': reason,
      'clientState': {'lastSeq': lastSeq, 'turnCount': turnCount},
      'clientEventId': clientEventId,
    }, aiTimeout),
  );

  /// `GET /v1/me/export` — the portable JSON bundle of everything the account holds (§11).
  Future<Map<String, Object?>> exportData() async => _object(await _send('GET', '/v1/me/export'));

  /// `DELETE /v1/me` — deletes the account on the server (`deleted`, or `scheduled` when the policy defers it).
  /// The literal confirmation is the API's own guard against accidental calls.
  Future<Map<String, Object?>> deleteAccount() async => _object(await _send('DELETE', '/v1/me', {'confirmation': 'DELETE', 'deleteOptInRecordings': true}));

  /// The AI routes (speech recognition, the character, synthesis) answer in a few seconds, at worst in the server's
  /// own budget; the other routes in well under a second.
  static const aiTimeout = Duration(seconds: 45);

  Future<Object?> _send(String method, String path, [Map<String, Object?>? body, Duration timeout = const Duration(seconds: 20)]) async {
    final token = await accessToken();
    final request = http.Request(method, Uri.parse('$baseUrl$path'))
      ..headers.addAll({
        if (token != null) 'Authorization': 'Bearer $token',
        if (body != null) 'Content-Type': 'application/json',
        'X-Client-Platform': _platform,
      });
    if (body != null) request.body = jsonEncode(body);
    http.Response res;
    try {
      res = await http.Response.fromStream(await _client.send(request).timeout(timeout));
    } catch (e) {
      throw ApiException(0, 'network', '$e');
    }
    Object? json;
    try {
      json = jsonDecode(res.body);
    } catch (_) {
      throw ApiException(res.statusCode, 'invalid_response', 'not JSON (HTTP ${res.statusCode})');
    }
    if (json is Map && json['ok'] == true) return json['data'];
    final error = json is Map && json['error'] is Map ? json['error'] as Map : const {};
    final details = error['details'] is Map ? (error['details'] as Map).cast<String, Object?>() : const <String, Object?>{};
    throw ApiException(res.statusCode, '${error['code'] ?? 'http_${res.statusCode}'}', '${error['message'] ?? ''}', details);
  }

  static Map<String, Object?> _object(Object? data) => data is Map ? data.cast<String, Object?>() : const {};
}
