import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';

// The public CDN lets browsers keep JavaScript and fonts for four hours. The HTML and JSON manifests
// are revalidated, so give the files they load a new URL whenever their bytes change.
void main(List<String> args) {
  final web = Directory(args.single);
  File file(String path) => File('${web.path}/$path');

  String publish(String path, List<int> bytes) {
    final dot = path.lastIndexOf('.');
    final hash = sha256.convert(bytes).toString().substring(0, 16);
    if (path.substring(0, dot).endsWith('.$hash')) return path;
    final name = '${path.substring(0, dot)}.$hash${path.substring(dot)}';
    file(name).writeAsBytesSync(bytes);
    return name;
  }

  String replaceReference(String source, Pattern old, String updated) {
    if (!source.contains(old)) throw StateError('Missing release reference: $old');
    return source.replaceFirst(old, updated);
  }

  final main = publish('main.dart.js', file('main.dart.js').readAsBytesSync());
  final loader = replaceReference(file('flutter_bootstrap.js').readAsStringSync(), '"mainJsPath":"main.dart.js"', '"mainJsPath":"$main"');
  final bootstrap = publish('flutter_bootstrap.js', utf8.encode(loader));
  // Tree-shaking changes icon codepoints available in a font when the UI changes. Existing HTML and
  // open tabs can still request the original file paths.
  final manifest = file('assets/FontManifest.json');
  final families = jsonDecode(manifest.readAsStringSync()) as List<dynamic>;
  for (final family in families) {
    for (final font in family['fonts'] as List<dynamic>) {
      final path = 'assets/${font['asset']}';
      font['asset'] = publish(path, file(path).readAsBytesSync()).substring('assets/'.length);
    }
  }
  manifest.writeAsStringSync(jsonEncode(families));

  final index = file('index.html');
  final script = RegExp(r'src="flutter_bootstrap(?:\.[0-9a-f]{16})?\.js"');
  index.writeAsStringSync(replaceReference(index.readAsStringSync(), script, 'src="$bootstrap"'));
}
