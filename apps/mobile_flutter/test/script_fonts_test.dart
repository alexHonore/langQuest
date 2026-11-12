// Reads fonts and the content bundle from disk (dart:io): VM only.
@TestOn('vm')
library;

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:langquest_mobile/core/theme/script_fonts.dart';

import 'support.dart';

/// The code points a TrueType/OpenType font maps to a glyph (Unicode cmap subtables, formats 4 and 12).
Set<int> cmapOf(String path) {
  final data = ByteData.sublistView(File(path).readAsBytesSync());
  int? cmap;
  for (var i = 0; i < data.getUint16(4); i++) {
    final record = 12 + 16 * i;
    if (String.fromCharCodes(Uint8List.sublistView(data, record, record + 4)) == 'cmap') cmap = data.getUint32(record + 8);
  }
  if (cmap == null) throw StateError('$path has no cmap table');
  final codePoints = <int>{};
  for (var i = 0; i < data.getUint16(cmap + 2); i++) {
    final platform = data.getUint16(cmap + 4 + 8 * i);
    if (platform != 0 && platform != 3) continue;
    final table = cmap + data.getUint32(cmap + 8 + 8 * i);
    switch (data.getUint16(table)) {
      case 4:
        final segments = data.getUint16(table + 6) ~/ 2;
        final ends = table + 14, starts = ends + 2 * segments + 2, deltas = starts + 2 * segments, ranges = deltas + 2 * segments;
        for (var s = 0; s < segments; s++) {
          final start = data.getUint16(starts + 2 * s), end = data.getUint16(ends + 2 * s);
          final delta = data.getUint16(deltas + 2 * s), rangeOffset = data.getUint16(ranges + 2 * s);
          for (var c = start; c <= end && c != 0xFFFF; c++) {
            var glyph = rangeOffset == 0 ? c : data.getUint16(ranges + 2 * s + rangeOffset + 2 * (c - start));
            if (rangeOffset != 0 && glyph == 0) continue;
            glyph = (glyph + delta) & 0xFFFF;
            if (glyph != 0) codePoints.add(c);
          }
        }
      case 12:
        for (var g = 0; g < data.getUint32(table + 12); g++) {
          final group = table + 16 + 12 * g;
          final start = data.getUint32(group), end = data.getUint32(group + 4), firstGlyph = data.getUint32(group + 8);
          for (var c = start; c <= end; c++) {
            if (firstGlyph + c - start != 0) codePoints.add(c);
          }
        }
    }
  }
  return codePoints;
}

/// Every string in a JSON value.
Iterable<String> stringsIn(Object? value) sync* {
  if (value is String) yield value;
  if (value is Map) {
    for (final v in value.values) {
      yield* stringsIn(v);
    }
  }
  if (value is List) {
    for (final v in value) {
      yield* stringsIn(v);
    }
  }
}

/// Characters that need a glyph (not controls, not spaces or line separators).
Set<int> drawn(Iterable<String> texts) => {
  for (final text in texts)
    for (final rune in text.runes)
      if (rune > 0x20 && !(rune >= 0x7F && rune <= 0x9F) && ![0x00A0, 0x200B, 0x200C, 0x200D, 0x200E, 0x200F, 0x2028, 0x2029, 0xFEFF].contains(rune)) rune,
};

String fileOf(String family) => family.replaceFirst('LQ ', '').replaceAll(' ', '');

void main() {
  final interfaceFonts = {
    for (final name in ['Inter-Regular', 'Inter-Medium', 'Inter-SemiBold', 'Outfit-SemiBold', 'Outfit-Bold']) ...cmapOf('assets/fonts/$name.ttf'),
  };
  final scriptFonts = {for (final family in scriptFontFamilies.values) family: cmapOf('assets/fonts/scripts/${fileOf(family)}-Regular.ttf')};
  String show(Iterable<int> codePoints) => codePoints.map((c) => '${String.fromCharCode(c)} U+${c.toRadixString(16).toUpperCase()}').join(', ');

  test('every script font is bundled in both weights, with the same characters', () {
    for (final family in scriptFontFamilies.values) {
      final bold = cmapOf('assets/fonts/scripts/${fileOf(family)}-Bold.ttf');
      expect(bold, scriptFonts[family], reason: family);
      expect(File('assets/fonts/OFL-${fileOf(family)}.txt').existsSync(), isTrue, reason: 'license of $family');
    }
  });

  test('each course draws its phrases and its native name with its own script font (the web downloads nothing)', () {
    final chapters = [for (final f in courseChapterFiles()) ...(jsonDecode(f.readAsStringSync()) as Map)['chapters'] as List];
    // The real examples (Tatoeba) of a course's phrases are drawn with its font too.
    final examples = (jsonDecode(File('assets/content/examples.json').readAsStringSync()) as Map)['phrases'] as Map;
    final problems = <String>[];
    for (final track in testBundle.tracks) {
      final phraseIds = {
        for (final c in testBundle.chapters.where((c) => c.courseTrackId == track.id)) ...c.missions.expand((m) => m.expressions).map((e) => e.id),
      };
      final texts = [
        track.nativeName,
        for (final c in chapters)
          if ((c as Map)['courseTrackId'] == track.id) ...stringsIn(c),
        for (final e in examples.entries)
          if (phraseIds.contains(e.key)) ...stringsIn(e.value),
      ];
      final own = scriptFontFamilies[track.primaryScript];
      final available = {...interfaceFonts, if (own != null) ...scriptFonts[own]!};
      final missing = drawn(texts).difference(available);
      if (missing.isNotEmpty) problems.add('${track.id} (${own ?? 'interface fonts'}): ${show(missing)}');
    }
    expect(problems, isEmpty, reason: 'Regenerate the subsets: tool/subset_fonts.py');
  });

  test('the interface (both languages, course names) needs nothing beyond the bundled fonts', () {
    final texts = [
      for (final file in ['lib/l10n/app_en.arb', 'lib/l10n/app_fr.arb']) ...stringsIn(jsonDecode(File(file).readAsStringSync())),
      for (final track in testBundle.tracks) ...track.names.values,
    ];
    final everything = {...interfaceFonts, for (final cmap in scriptFonts.values) ...cmap};
    expect(show(drawn(texts).difference(everything)), isEmpty);
  });

  test('a course puts its own script font first, so Japanese kanji are not drawn with Chinese forms', () {
    final japanese = testBundle.track('japanese')!;
    final mandarin = testBundle.tracks.firstWhere((t) => t.primaryScript == 'Hans');
    final spanish = testBundle.track('spanish-spain')!;
    expect(fontFallbackFor(japanese).first, 'LQ Noto Sans JP');
    expect(fontFallbackFor(mandarin).first, 'LQ Noto Sans SC');
    expect(fontFallbackFor(spanish), scriptFontFallback);
    expect(fontFallbackFor(japanese).toSet(), scriptFontFallback.toSet());
  });
}
