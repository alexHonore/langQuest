// Reads files from disk (dart:io): VM only.
@TestOn('vm')
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:langquest_mobile/features/call/call_portrait.dart';

/// The portraits in `assets/characters` are copies of the art roster's (repo `assets/characters/<id>/<expression>.svg`,
/// owner-approved C2): every listed character has every expression, byte for byte the roster's, and nothing else ships.
void main() {
  test('the bundled portraits are the art roster\'s, complete', () {
    final shipped = Directory('assets/characters').listSync().whereType<File>().map((f) => f.uri.pathSegments.last).toSet();
    final expected = {
      for (final id in portraitRoster)
        for (final e in portraitExpressions) '$id.$e.svg',
    };
    expect(shipped, expected);
    final roster = Directory('../../assets/characters');
    if (!roster.existsSync()) return; // a checkout of the app alone
    for (final id in portraitRoster) {
      for (final e in portraitExpressions) {
        expect(File('assets/characters/$id.$e.svg').readAsBytesSync(), File('${roster.path}/$id/$e.svg').readAsBytesSync(), reason: '$id $e');
      }
    }
  });

  test('the cast of every bundled course has portraits', () {
    // The varieties of the courses the bundle can teach (catalog.json): their roster characters all ship.
    final roster = Directory('../../assets/characters');
    if (!roster.existsSync()) return;
    final cast = roster
        .listSync()
        .whereType<Directory>()
        .map((d) => d.uri.pathSegments.where((s) => s.isNotEmpty).last)
        .where((id) => ['es-es-', 'ja-', 'en-', 'ary-'].any(id.startsWith));
    expect(portraitRoster.toSet(), cast.toSet());
  });
}
