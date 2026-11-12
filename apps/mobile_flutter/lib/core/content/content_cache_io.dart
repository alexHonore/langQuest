import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

import 'content_cache.dart';

/// Files under the app's support folder (`content-cache/<object name>`), which the system does not clear on its own.
Future<ContentCache> openContentCache() async {
  try {
    final dir = Directory('${(await getApplicationSupportDirectory()).path}/content-cache');
    return FileContentCache(dir);
  } catch (e) {
    debugPrint('No content cache on this device: $e');
    return MemoryContentCache(keep: false);
  }
}

class FileContentCache implements ContentCache {
  FileContentCache(this.dir);

  final Directory dir;

  File _file(String name) => File('${dir.path}/$name');

  @override
  Future<String?> read(String name) async {
    try {
      final f = _file(name);
      return await f.exists() ? await f.readAsString() : null;
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> write(String name, String text) async {
    try {
      final f = _file(name);
      await f.parent.create(recursive: true);
      // Written whole, then renamed: a file cut short by the app closing is never read back.
      final tmp = File('${f.path}.part');
      await tmp.writeAsString(text, flush: true);
      await tmp.rename(f.path);
    } catch (e) {
      debugPrint('Content not kept ($name): $e');
    }
  }

  Future<List<String>> _names() async {
    if (!await dir.exists()) return const [];
    final prefix = '${dir.path}/';
    return [
      await for (final e in dir.list(recursive: true))
        if (e is File && !e.path.endsWith('.part')) e.path.substring(prefix.length),
    ];
  }

  @override
  Future<void> removeWhere(bool Function(String name) test) async {
    for (final name in await _names()) {
      if (test(name)) await _file(name).delete().catchError((_) => _file(name));
    }
  }

  @override
  Future<void> keepOnly(Set<String> names) => removeWhere((name) => !names.contains(name));
}
