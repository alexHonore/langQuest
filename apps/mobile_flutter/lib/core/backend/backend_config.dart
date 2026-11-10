import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

/// Where a learner's account lives: the Supabase project (sign-in) and the LangQuest API Worker (courses, progress).
/// Client-safe values only — the anon key is public by design; no secret ever reaches the app.
///
/// Without it the app is what it always was: offline, progress on the device, no account features shown.
@immutable
class BackendConfig {
  const BackendConfig({required this.supabaseUrl, required this.supabaseAnonKey, required this.apiBaseUrl});

  final String supabaseUrl;
  final String supabaseAnonKey;
  final String apiBaseUrl;

  /// A config only when every value is present (a half-configured build stays offline).
  static BackendConfig? from({String? supabaseUrl, String? supabaseAnonKey, String? apiBaseUrl}) {
    String clean(String? v) => (v ?? '').trim();
    final url = clean(supabaseUrl), key = clean(supabaseAnonKey), api = clean(apiBaseUrl).replaceAll(RegExp(r'/+$'), '');
    if (url.isEmpty || key.isEmpty || api.isEmpty) return null;
    return BackendConfig(supabaseUrl: url, supabaseAnonKey: key, apiBaseUrl: api);
  }

  static BackendConfig? fromJson(Object? json) =>
      json is Map ? from(supabaseUrl: json['supabaseUrl'] as String?, supabaseAnonKey: json['supabaseAnonKey'] as String?, apiBaseUrl: json['apiBaseUrl'] as String?) : null;
}

/// Build-time values (`--dart-define=LQ_SUPABASE_URL=… LQ_SUPABASE_ANON_KEY=… LQ_API_BASE_URL=…`) for native builds;
/// on the web, `config.json` next to `index.html`, which the web image writes from its environment at start-up
/// (`deploy/entrypoint.sh`), so one image serves any instance.
Future<BackendConfig?> loadBackendConfig({http.Client? client}) async {
  final defined = BackendConfig.from(
    supabaseUrl: const String.fromEnvironment('LQ_SUPABASE_URL'),
    supabaseAnonKey: const String.fromEnvironment('LQ_SUPABASE_ANON_KEY'),
    apiBaseUrl: const String.fromEnvironment('LQ_API_BASE_URL'),
  );
  if (defined != null || !kIsWeb) return defined;
  final c = client ?? http.Client();
  try {
    final res = await c.get(Uri.base.resolve('config.json')).timeout(const Duration(seconds: 5));
    if (res.statusCode != 200) return null;
    return BackendConfig.fromJson(jsonDecode(res.body));
  } catch (_) {
    return null;
  } finally {
    if (client == null) c.close();
  }
}
