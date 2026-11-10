import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

/// An answer of the API that is not `{ok: true}`: [status] is the HTTP status, [code] the API's error code
/// (`conflict`, `validation_failed`, `unauthorized`, `provider_unavailable`…).
class ApiException implements Exception {
  ApiException(this.status, this.code, this.message);

  final int status;
  final String code;
  final String message;

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

  /// `GET /v1/me/export` — the portable JSON bundle of everything the account holds (§11).
  Future<Map<String, Object?>> exportData() async => _object(await _send('GET', '/v1/me/export'));

  /// `DELETE /v1/me` — deletes the account on the server (`deleted`, or `scheduled` when the policy defers it).
  /// The literal confirmation is the API's own guard against accidental calls.
  Future<Map<String, Object?>> deleteAccount() async => _object(await _send('DELETE', '/v1/me', {'confirmation': 'DELETE', 'deleteOptInRecordings': true}));

  Future<Object?> _send(String method, String path, [Map<String, Object?>? body]) async {
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
      res = await http.Response.fromStream(await _client.send(request).timeout(const Duration(seconds: 20)));
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
    throw ApiException(res.statusCode, '${error['code'] ?? 'http_${res.statusCode}'}', '${error['message'] ?? ''}');
  }

  static Map<String, Object?> _object(Object? data) => data is Map ? data.cast<String, Object?>() : const {};
}
