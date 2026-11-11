// Drops from a web build the fonts the app never uses, which the web engine would otherwise download at start-up
// (it loads every family in assets/FontManifest.json). lucide_icons_flutter declares six weight variants
// (LucideVariable-w100…w600, about 1.4 MB, a quarter of a first visit) for its lucide_icons_<weight>.dart libraries;
// the app imports only lucide_icons.dart, whose icons use the tree-shaken `Lucide` family.
//
// Usage, after `flutter build web`, from the package root:  dart tool/prune_web_fonts.dart build/web
import 'dart:convert';
import 'dart:io';

const unusedFamilies = {
  'packages/lucide_icons_flutter/Lucide100',
  'packages/lucide_icons_flutter/Lucide200',
  'packages/lucide_icons_flutter/Lucide300',
  'packages/lucide_icons_flutter/Lucide400',
  'packages/lucide_icons_flutter/Lucide500',
  'packages/lucide_icons_flutter/Lucide600',
};

void main(List<String> args) {
  final web = Directory(args.isEmpty ? 'build/web' : args.first);

  // The families are unused only while no code imports a weight library: refuse rather than break its icons.
  final weightImport = RegExp(r"package:lucide_icons_flutter/lucide_icons_\d00\.dart");
  for (final file in Directory('lib').listSync(recursive: true).whereType<File>().where((f) => f.path.endsWith('.dart'))) {
    if (weightImport.hasMatch(file.readAsStringSync())) {
      stderr.writeln('${file.path} imports a Lucide weight library: its font family must stay in the build.');
      exit(1);
    }
  }

  final manifest = File('${web.path}/assets/FontManifest.json');
  final families = (jsonDecode(manifest.readAsStringSync()) as List).cast<Map<String, dynamic>>();
  final kept = <Map<String, dynamic>>[];
  var removed = 0;
  var bytes = 0;
  for (final family in families) {
    if (!unusedFamilies.contains(family['family'])) {
      kept.add(family);
      continue;
    }
    removed++;
    for (final font in (family['fonts'] as List).cast<Map<String, dynamic>>()) {
      final file = File('${web.path}/assets/${font['asset']}');
      if (file.existsSync()) {
        bytes += file.lengthSync();
        file.deleteSync();
      }
    }
  }
  manifest.writeAsStringSync(jsonEncode(kept));
  stdout.writeln('Pruned $removed unused font families (${(bytes / 1024).round()} KB) from ${web.path}.');
}
