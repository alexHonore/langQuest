import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:langquest_mobile/features/scenes/scene_models.dart';
import 'package:langquest_mobile/features/scenes/scene_painter.dart';

Future<String> fingerprint(SceneId id, SceneVariant variant, double progress) async {
  final recorder = ui.PictureRecorder();
  ScenePainter(sceneId: id, variant: variant, animationProgress: progress).paint(Canvas(recorder), const Size(160, 90));
  final image = await recorder.endRecording().toImage(160, 90);
  final bytes = await image.toByteData();
  image.dispose();
  return base64Encode(bytes!.buffer.asUint8List());
}

void main() {
  test('every scene paints, day and evening, all through its loop', () {
    for (final id in SceneId.values) {
      for (final variant in SceneVariant.values) {
        for (final progress in [0.0, 0.25, 0.5, 0.75, 0.999]) {
          final recorder = ui.PictureRecorder();
          ScenePainter(sceneId: id, variant: variant, animationProgress: progress).paint(Canvas(recorder), const Size(320, 180));
          recorder.endRecording().dispose();
        }
      }
    }
  });

  testWidgets('every place looks like itself (no shared stand-in room), and moves', (t) async {
    await t.runAsync(() async {
      for (final variant in SceneVariant.values) {
        final seen = <String, SceneId>{};
        for (final id in SceneId.values) {
          final still = await fingerprint(id, variant, 0.1);
          expect(seen[still], isNull, reason: '${id.name} (${variant.name}) paints the same picture as ${seen[still]?.name}');
          seen[still] = id;
          expect(await fingerprint(id, variant, 0.6), isNot(still), reason: '${id.name} (${variant.name}) does not move');
        }
      }
    });
  });
}
