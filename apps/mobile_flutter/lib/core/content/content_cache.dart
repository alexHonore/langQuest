import 'content_cache_stub.dart' if (dart.library.io) 'content_cache_io.dart' as platform;

/// What the app keeps of the content on the device, by object name (`content/chapters/<track>.<hash>.json`): only the
/// files the learner's selection needed ([ContentSource]). On the web the browser keeps them (its HTTP cache, and the
/// offline service worker `web/sw.js`), so this one holds nothing there.
abstract class ContentCache {
  Future<String?> read(String name);
  Future<void> write(String name, String text);

  /// Drops every kept file [test] matches.
  Future<void> removeWhere(bool Function(String name) test);

  /// Drops every kept file not in [names] (older copies of files the bucket has since replaced).
  Future<void> keepOnly(Set<String> names);
}

/// The device's cache: files in the app's support folder (iOS, Android, desktop); none on the web.
Future<ContentCache> openContentCache() => platform.openContentCache();

/// Keeps nothing (the web), or keeps in memory (tests).
class MemoryContentCache implements ContentCache {
  MemoryContentCache({this.keep = true});

  final bool keep;
  final files = <String, String>{};

  @override
  Future<String?> read(String name) async => files[name];

  @override
  Future<void> write(String name, String text) async {
    if (keep) files[name] = text;
  }

  @override
  Future<void> removeWhere(bool Function(String name) test) async => files.removeWhere((name, _) => test(name));

  @override
  Future<void> keepOnly(Set<String> names) async => files.removeWhere((name, _) => !names.contains(name));
}
