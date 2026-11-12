import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import '../platform/content_worker.dart';
import 'content_cache.dart';

/// The published content bucket (a public Supabase Storage bucket on the instance, filled by
/// `pnpm --filter @langquest/scripts publish-content`): the catalog, each course's chapters and voices, and the clips.
/// `config.json`'s `contentBaseUrl` (the web image's `LQ_CONTENT_BASE_URL`) points the app at another copy.
const defaultContentBaseUrl = 'https://sb-languest.tayoo.app/storage/v1/object/public/langquest-content/';

/// Where the content lives, and how a file of the repository's layout (`assets/content/…`, `assets/audio/…`) is named
/// there. The bucket names its JSON files by content (`content/chapters/spanish-spain.<hash>.json`, listed in its
/// `index.json`), so a cached copy never goes stale; a copy without an index (the repository's own folder, served as
/// is) is read under the same paths as in the repository.
class ContentLocation {
  ContentLocation(Uri base) : base = base.path.endsWith('/') ? base : base.replace(path: '${base.path}/');

  /// [url] (absolute, or relative to the page) as a location; the published bucket when it is empty.
  factory ContentLocation.parse(String? url) {
    final value = (url ?? '').trim();
    return ContentLocation(Uri.base.resolve(value.isEmpty ? defaultContentBaseUrl : value));
  }

  final Uri base;

  /// [repoPath] (`assets/audio/lines/x.mp3`, `assets/content/catalog.json`) without the app-bundle prefix.
  static String key(String repoPath) => repoPath.startsWith('assets/') ? repoPath.substring('assets/'.length) : repoPath;

  /// The address of the clip at [repoPath] (clips are named by what they say: they never change under a name).
  Uri clip(String repoPath) => base.resolve(key(repoPath));
}

/// Reads the app's content from its [location], keeping on the device ([cache]) only what the learner selected: the
/// shared files and the chapters and voices of the courses they read. A course left ([forgetCourse]) leaves the cache.
/// Without the network, the cached copy is used.
class ContentSource {
  ContentSource({required this.location, required this.cache, http.Client? client}) : _client = client ?? http.Client();

  final ContentLocation location;
  final ContentCache cache;
  final http.Client _client;

  /// Repository path (without `assets/`) → object name in the bucket; empty when the copy has no index.
  Future<Map<String, String>>? _index;

  static const indexKey = 'index.json';

  Future<Map<String, String>> _readIndex() async {
    try {
      final res = await _client.get(location.base.resolve(indexKey), headers: const {'cache-control': 'no-cache'}).timeout(const Duration(seconds: 10));
      if (res.statusCode == 200) {
        final index = parseIndex(res.body);
        unawaited(cache.write(indexKey, res.body));
        unawaited(cache.keepOnly({indexKey, ...index.values}));
        return index;
      }
      // No index: a plain copy of the repository's folders, read as is.
      if (res.statusCode == 404 || res.statusCode == 400) return const {};
    } catch (e) {
      debugPrint('Content index not reachable: $e');
    }
    final cached = await cache.read(indexKey);
    return cached == null ? const {} : parseIndex(cached);
  }

  /// The `files` map of the bucket's `index.json`.
  static Map<String, String> parseIndex(String source) {
    final json = jsonDecode(source);
    final files = json is Map && json['files'] is Map ? json['files'] as Map : const {};
    return {
      for (final e in files.entries)
        if (e.value is String) '${e.key}': e.value as String,
    };
  }

  /// The text of [repoPath] (`assets/content/chapters/spanish-spain.json`): from the device when it was kept, else
  /// from the bucket (then kept). Throws when it can be had from neither.
  Future<String> read(String repoPath) async {
    final index = await (_index ??= _readIndex());
    final key = ContentLocation.key(repoPath);
    final object = index[key];
    // A named-by-content object never changes: the kept copy is the object. Without an index, the network decides.
    if (object != null) {
      final kept = await cache.read(object);
      if (kept != null) return kept;
    }
    final name = object ?? key;
    try {
      final res = await _client.get(location.base.resolve(name)).timeout(const Duration(seconds: 30));
      if (res.statusCode == 200) {
        final body = utf8.decode(res.bodyBytes);
        unawaited(cache.write(name, body));
        return body;
      }
      throw http.ClientException('HTTP ${res.statusCode}', location.base.resolve(name));
    } catch (e) {
      final kept = await cache.read(name);
      if (kept != null) return kept;
      rethrow;
    }
  }

  /// Forgets what was kept of [trackId] (its chapters and voices): the learner left the course.
  Future<void> forgetCourse(String trackId) {
    forgetCourseInServiceWorker(trackId);
    return cache.removeWhere((name) => isCourseFile(name, trackId));
  }

  /// Whether the object [name] (`content/chapters/<track>.json` or `content/chapters/<track>.<hash>.json`) is one of
  /// [trackId]'s own files.
  static bool isCourseFile(String name, String trackId) {
    for (final dir in const ['content/chapters/', 'content/voices/']) {
      if (!name.startsWith(dir)) continue;
      final file = name.substring(dir.length);
      return file == '$trackId.json' || (file.startsWith('$trackId.') && RegExp(r'^\.[0-9a-f]{8,}\.json$').hasMatch(file.substring(trackId.length)));
    }
    return false;
  }
}

/// The app's content source; null in tests that give the bundle directly.
final contentSourceProvider = Provider<ContentSource?>((ref) => null);

/// Where clips are played from: the content source's location, else the repository's layout under the web build's
/// `assets/` (tests).
final contentLocationProvider = Provider<ContentLocation>((ref) => ref.watch(contentSourceProvider)?.location ?? ContentLocation(Uri.parse('assets/')));

/// Where to read the content: `--dart-define=LQ_CONTENT_BASE_URL=…` for native builds; on the web, `config.json`'s
/// `contentBaseUrl` (filled by the web image from `LQ_CONTENT_BASE_URL`). Empty: the published bucket.
Future<String?> loadContentBaseUrl({http.Client? client}) async {
  const defined = String.fromEnvironment('LQ_CONTENT_BASE_URL');
  if (defined.isNotEmpty || !kIsWeb) return defined;
  final c = client ?? http.Client();
  try {
    final res = await c.get(Uri.base.resolve('config.json')).timeout(const Duration(seconds: 5));
    if (res.statusCode != 200) return null;
    final json = jsonDecode(res.body);
    return json is Map && json['contentBaseUrl'] is String ? json['contentBaseUrl'] as String : null;
  } catch (_) {
    return null;
  } finally {
    if (client == null) c.close();
  }
}
