import 'content_cache.dart';

/// The web: the browser keeps the content (HTTP cache, `web/sw.js`).
Future<ContentCache> openContentCache() async => MemoryContentCache(keep: false);
