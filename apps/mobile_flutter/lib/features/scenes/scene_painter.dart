import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'scene_models.dart';

class ScenePainter extends CustomPainter {
  final SceneId sceneId;
  final SceneVariant variant;
  final double animationProgress; // 0..1 loop
  final Offset parallaxOffset;

  ScenePainter({
    required this.sceneId,
    required this.variant,
    required this.animationProgress,
    this.parallaxOffset = Offset.zero,
  });

  @override
  void paint(Canvas canvas, Size size) {
    // 160 x 90 coordinate system (16:9 widescreen)
    final double scale = math.max(size.width / 160.0, size.height / 90.0);
    canvas.save();
    canvas.translate(
      (size.width - 160.0 * scale) / 2.0 + parallaxOffset.dx * 12.0,
      (size.height - 90.0 * scale) / 2.0 + parallaxOffset.dy * 8.0,
    );
    canvas.scale(scale);

    final bool isEvening = variant == SceneVariant.evening;

    // --- Base Sky / Wall Background ---
    _drawSky(canvas, isEvening);

    // --- Scene Specific Architecture & Details ---
    switch (sceneId) {
      case SceneId.cafe:
        _drawCafe(canvas, isEvening);
        break;
      case SceneId.street:
        _drawStreet(canvas, isEvening);
        break;
      case SceneId.airport:
        _drawAirport(canvas, isEvening);
        break;
      case SceneId.market:
        _drawMarket(canvas, isEvening);
        break;
      default:
        _drawGenericInterior(canvas, isEvening);
        break;
    }

    // --- Foreground Calm Scrim for text readability ---
    final scrimPaint = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [
          Colors.transparent,
          isEvening ? const Color(0xBB0B0913) : const Color(0x991A1430),
        ],
      ).createShader(const Rect.fromLTWH(0, 0, 160, 90));
    canvas.drawRect(const Rect.fromLTWH(0, 0, 160, 90), scrimPaint);

    canvas.restore();
  }

  void _drawSky(Canvas canvas, bool isEvening) {
    final skyPaint = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: isEvening
            ? [const Color(0xFF130E26), const Color(0xFF261947), const Color(0xFF3F2B66)]
            : [const Color(0xFF74B9FF), const Color(0xFFA0C4FF), const Color(0xFFFFEAA7)],
      ).createShader(const Rect.fromLTWH(0, 0, 160, 90));

    canvas.drawRect(const Rect.fromLTWH(0, 0, 160, 90), skyPaint);

    if (isEvening) {
      // Twinkling stars
      final starPaint = Paint()..color = Colors.white;
      for (int i = 0; i < 18; i++) {
        final sx = (i * 37) % 150 + 5.0;
        final sy = (i * 23) % 40 + 5.0;
        final twinkle = (math.sin(animationProgress * math.pi * 2 + i) + 1.0) / 2.0;
        starPaint.color = Colors.white.withValues(alpha: 0.2 + twinkle * 0.7);
        canvas.drawCircle(Offset(sx, sy), 0.7 + twinkle * 0.5, starPaint);
      }
    }
  }

  void _drawCafe(Canvas canvas, bool isEvening) {
    // Large Sunny / Warm Window
    final windowPaint = Paint()
      ..color = isEvening ? const Color(0xFF1D1735) : const Color(0xFFBCE0FD);
    canvas.drawRRect(
      RRect.fromRectAndRadius(const Rect.fromLTWH(18, 12, 60, 50), const Radius.circular(4)),
      windowPaint,
    );

    // Window frame
    final framePaint = Paint()
      ..color = const Color(0xFF5D4037)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.0;
    canvas.drawRRect(
      RRect.fromRectAndRadius(const Rect.fromLTWH(18, 12, 60, 50), const Radius.circular(4)),
      framePaint,
    );
    canvas.drawLine(const Offset(48, 12), const Offset(48, 62), framePaint);

    // Warm Sunbeam / Lamp Light through window
    final sunbeamPaint = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [
          (isEvening ? const Color(0xFFFF9F43) : const Color(0xFFFFF9E6)).withValues(alpha: 0.25),
          Colors.transparent,
        ],
      ).createShader(const Rect.fromLTWH(18, 12, 100, 78));
    final beamPath = Path()
      ..moveTo(18, 12)
      ..lineTo(78, 12)
      ..lineTo(140, 90)
      ..lineTo(50, 90)
      ..close();
    canvas.drawPath(beamPath, sunbeamPaint);

    // Wooden Counter
    final counterPaint = Paint()
      ..shader = const LinearGradient(
        colors: [Color(0xFF8D6E63), Color(0xFF5D4037)],
      ).createShader(const Rect.fromLTWH(0, 62, 160, 28));
    canvas.drawRect(const Rect.fromLTWH(0, 62, 160, 28), counterPaint);

    // Espresso machine on counter
    final machinePaint = Paint()..color = const Color(0xFFB0BEC5);
    canvas.drawRRect(
      RRect.fromRectAndRadius(const Rect.fromLTWH(26, 42, 28, 22), const Radius.circular(3)),
      machinePaint,
    );
    // Espresso accents
    canvas.drawRect(
      const Rect.fromLTWH(29, 45, 12, 5),
      Paint()..color = const Color(0xFF37474F),
    );

    // Coffee cup on counter
    final cupPaint = Paint()..color = const Color(0xFFF5F2FB);
    canvas.drawRRect(
      RRect.fromRectAndRadius(const Rect.fromLTWH(62, 55, 9, 8), const Radius.circular(2)),
      cupPaint,
    );

    // Rising animated coffee steam!
    final steamPaint = Paint()
      ..color = Colors.white.withValues(alpha: 0.4)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2
      ..strokeCap = StrokeCap.round;

    for (int s = 0; s < 3; s++) {
      final steamPath = Path();
      final steamX = 64.0 + s * 2.2;
      final offset = (animationProgress + s * 0.33) % 1.0;
      final steamY = 54.0 - offset * 14.0;
      final sway = math.sin(offset * math.pi * 3.0) * 2.0;

      steamPaint.color = Colors.white.withValues(alpha: (1.0 - offset) * 0.45);
      steamPath.moveTo(steamX, steamY + 4);
      steamPath.quadraticBezierTo(steamX + sway, steamY + 2, steamX - sway, steamY);
      canvas.drawPath(steamPath, steamPaint);
    }

    // Pastry glass bell
    final domePaint = Paint()
      ..color = const Color(0x33FFFFFF)
      ..style = PaintingStyle.fill;
    canvas.drawOval(const Rect.fromLTWH(118, 50, 24, 16), domePaint);
    canvas.drawOval(
      const Rect.fromLTWH(124, 56, 12, 6),
      Paint()..color = const Color(0xFFFFB547),
    );
  }

  void _drawStreet(Canvas canvas, bool isEvening) {
    // City building silhouettes
    final bldgPaint = Paint()..color = isEvening ? const Color(0xFF1B142F) : const Color(0xFF4A4E69);
    canvas.drawRect(const Rect.fromLTWH(0, 20, 42, 70), bldgPaint);
    canvas.drawRect(const Rect.fromLTWH(46, 12, 38, 78), bldgPaint);
    canvas.drawRect(const Rect.fromLTWH(114, 18, 46, 72), bldgPaint);

    // Glowing shop windows
    final windowColor = isEvening ? const Color(0xFFFFC048) : const Color(0xFFFFF1C5);
    final winPaint = Paint()..color = windowColor.withValues(alpha: isEvening ? 0.85 : 0.45);
    for (int row = 0; row < 4; row++) {
      canvas.drawRect(Rect.fromLTWH(52, 22.0 + row * 9, 8, 6), winPaint);
      canvas.drawRect(Rect.fromLTWH(68, 22.0 + row * 9, 8, 6), winPaint);
      canvas.drawRect(Rect.fromLTWH(122, 26.0 + row * 9, 10, 6), winPaint);
      canvas.drawRect(Rect.fromLTWH(140, 26.0 + row * 9, 10, 6), winPaint);
    }

    // Street pavement
    final streetPaint = Paint()..color = isEvening ? const Color(0xFF0F0B1A) : const Color(0xFF22223B);
    canvas.drawRect(const Rect.fromLTWH(0, 72, 160, 18), streetPaint);

    // Hanging string with Swaying Lanterns!
    final wirePaint = Paint()
      ..color = const Color(0xFF4A4E69)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0;
    final wirePath = Path()
      ..moveTo(0, 18)
      ..quadraticBezierTo(80, 28, 160, 18);
    canvas.drawPath(wirePath, wirePaint);

    // 4 Animated Swaying Lanterns
    for (int l = 0; l < 4; l++) {
      final lx = 24.0 + l * 36.0;
      final ly = 19.5 + math.sin((lx / 160.0) * math.pi) * 6.5;

      final sway = math.sin(animationProgress * math.pi * 2 + l * 1.5) * 0.12;

      canvas.save();
      canvas.translate(lx, ly);
      canvas.rotate(sway);

      // Lantern cord
      canvas.drawLine(Offset.zero, const Offset(0, 4), wirePaint);

      // Lantern glow bloom
      final glowPaint = Paint()
        ..shader = RadialGradient(
          colors: [
            (l % 2 == 0 ? const Color(0xFFFF4FA3) : const Color(0xFFFFB547)).withValues(alpha: 0.5),
            Colors.transparent,
          ],
        ).createShader(const Rect.fromLTWH(-12, 0, 24, 24));
      canvas.drawCircle(const Offset(0, 10), 12, glowPaint);

      // Lantern body
      final lanternPaint = Paint()
        ..color = l % 2 == 0 ? const Color(0xFFFF4FA3) : const Color(0xFFFFB547);
      canvas.drawRRect(
        RRect.fromRectAndRadius(const Rect.fromLTWH(-5, 4, 10, 12), const Radius.circular(3)),
        lanternPaint,
      );

      // Lantern rib
      canvas.drawCircle(
        const Offset(0, 10),
        2.5,
        Paint()..color = const Color(0xFFFFF275),
      );

      canvas.restore();
    }
  }

  void _drawAirport(Canvas canvas, bool isEvening) {
    // Vast glass curtain wall
    final glassPaint = Paint()
      ..color = isEvening ? const Color(0xFF131A33) : const Color(0xFF81B0E8);
    canvas.drawRect(const Rect.fromLTWH(0, 0, 160, 68), glassPaint);

    // Distant runway
    final runwayPaint = Paint()..color = const Color(0xFF263238);
    canvas.drawRect(const Rect.fromLTWH(0, 52, 160, 16), runwayPaint);

    // Runway strobe lights
    final lightColor = (animationProgress * 3).toInt() % 2 == 0
        ? const Color(0xFF45E0A6)
        : const Color(0xFFFFB547);
    for (int i = 0; i < 10; i++) {
      canvas.drawCircle(
        Offset(16.0 + i * 14.0, 56),
        1.5,
        Paint()..color = lightColor,
      );
    }

    // Terminal pillars
    final pillarPaint = Paint()..color = const Color(0xFF455A64);
    for (int p = 0; p < 4; p++) {
      canvas.drawRect(Rect.fromLTWH(12.0 + p * 44.0, 0, 6, 68), pillarPaint);
    }

    // Polished terminal floor reflection
    final floorPaint = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: isEvening
            ? [const Color(0xFF1C2237), const Color(0xFF0F1424)]
            : [const Color(0xFFECEFF1), const Color(0xFFCFD8DC)],
      ).createShader(const Rect.fromLTWH(0, 68, 160, 22));
    canvas.drawRect(const Rect.fromLTWH(0, 68, 160, 22), floorPaint);
  }

  void _drawMarket(Canvas canvas, bool isEvening) {
    // Stalls & awnings
    final stallPaint = Paint()..color = const Color(0xFF5D4037);
    canvas.drawRect(const Rect.fromLTWH(8, 48, 54, 32), stallPaint);
    canvas.drawRect(const Rect.fromLTWH(98, 48, 54, 32), stallPaint);

    // Fluttering fabric awnings
    final wave = math.sin(animationProgress * math.pi * 2) * 1.5;
    final awningPath = Path()
      ..moveTo(6, 48)
      ..lineTo(64, 48)
      ..lineTo(68 + wave, 56)
      ..lineTo(2 + wave, 56)
      ..close();
    canvas.drawPath(
      awningPath,
      Paint()..color = const Color(0xFFFF6B6B),
    );

    final awning2Path = Path()
      ..moveTo(96, 48)
      ..lineTo(154, 48)
      ..lineTo(158 + wave, 56)
      ..lineTo(92 + wave, 56)
      ..close();
    canvas.drawPath(
      awning2Path,
      Paint()..color = const Color(0xFF4ECDC4),
    );

    // Fruit and spice baskets
    for (int b = 0; b < 3; b++) {
      canvas.drawOval(
        Rect.fromLTWH(14.0 + b * 14.0, 58, 11, 7),
        Paint()..color = [const Color(0xFFFF9F43), const Color(0xFFEE5253), const Color(0xFF10AC84)][b],
      );
      canvas.drawOval(
        Rect.fromLTWH(104.0 + b * 14.0, 58, 11, 7),
        Paint()..color = [const Color(0xFFF368E0), const Color(0xFFFF9F43), const Color(0xFFFFD32A)][b],
      );
    }
  }

  void _drawGenericInterior(Canvas canvas, bool isEvening) {
    // Modern warm room with window & art
    final wallPaint = Paint()
      ..color = isEvening ? const Color(0xFF1C1730) : const Color(0xFFE8E5F0);
    canvas.drawRect(const Rect.fromLTWH(0, 0, 160, 72), wallPaint);

    // Modern floor
    final floorPaint = Paint()
      ..color = isEvening ? const Color(0xFF130F21) : const Color(0xFFD4CFE2);
    canvas.drawRect(const Rect.fromLTWH(0, 72, 160, 18), floorPaint);

    // Window with gentle light
    canvas.drawRRect(
      RRect.fromRectAndRadius(const Rect.fromLTWH(18, 14, 52, 44), const Radius.circular(3)),
      Paint()..color = isEvening ? const Color(0xFF261D42) : const Color(0xFFA5C8F0),
    );

    // Wall picture frame
    canvas.drawRect(
      const Rect.fromLTWH(108, 18, 32, 22),
      Paint()..color = const Color(0xFFFFB547).withValues(alpha: 0.8),
    );
  }

  @override
  bool shouldRepaint(covariant ScenePainter oldDelegate) {
    return oldDelegate.animationProgress != animationProgress ||
        oldDelegate.sceneId != sceneId ||
        oldDelegate.variant != variant ||
        oldDelegate.parallaxOffset != parallaxOffset;
  }
}
