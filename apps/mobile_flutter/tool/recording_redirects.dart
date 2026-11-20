import 'dart:convert';
import 'dart:io';

// Preserve shared links to previous versions of a recording. The app resolves the same names in
// cached course manifests; these redirects also work for a learner opening an MP3 directly.
void main() {
  final manifest = jsonDecode(File('assets/audio/repairs.json').readAsStringSync()) as Map;
  const root = '/assets/assets/audio';
  for (final repair in manifest.values) {
    for (final previous in repair['previousFiles'] as List? ?? const []) {
      stdout.writeln('redir "$root/$previous" "$root/${repair['file']}" 302');
    }
  }
}
