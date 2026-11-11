import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'scene_models.dart';

class ScenePainter extends CustomPainter {
  final SceneId sceneId;
  final SceneVariant variant;
  final double animationProgress; // 0..1 loop
  final Offset parallaxOffset;

  ScenePainter({required this.sceneId, required this.variant, required this.animationProgress, this.parallaxOffset = Offset.zero});

  @override
  void paint(Canvas canvas, Size size) {
    // 160 x 90 coordinate system (16:9 widescreen)
    final double scale = math.max(size.width / 160.0, size.height / 90.0);
    canvas.save();
    canvas.translate((size.width - 160.0 * scale) / 2.0 + parallaxOffset.dx * 12.0, (size.height - 90.0 * scale) / 2.0 + parallaxOffset.dy * 8.0);
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
      case SceneId.home:
        _drawHome(canvas, isEvening);
        break;
      case SceneId.office:
        _drawOffice(canvas, isEvening);
        break;
      case SceneId.transit:
        _drawTransit(canvas, isEvening);
        break;
      case SceneId.restaurant:
        _drawRestaurant(canvas, isEvening);
        break;
      case SceneId.gathering:
        _drawGathering(canvas, isEvening);
        break;
      case SceneId.station:
        _drawStation(canvas, isEvening);
        break;
      case SceneId.park:
        _drawPark(canvas, isEvening);
        break;
      case SceneId.clinic:
        _drawClinic(canvas, isEvening);
        break;
    }

    // --- Foreground Calm Scrim for text readability ---
    final scrimPaint = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [Colors.transparent, isEvening ? const Color(0xBB0B0913) : const Color(0x991A1430)],
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
    final windowPaint = Paint()..color = isEvening ? const Color(0xFF1D1735) : const Color(0xFFBCE0FD);
    canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(18, 12, 60, 50), const Radius.circular(4)), windowPaint);

    // Window frame
    final framePaint = Paint()
      ..color = const Color(0xFF5D4037)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.0;
    canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(18, 12, 60, 50), const Radius.circular(4)), framePaint);
    canvas.drawLine(const Offset(48, 12), const Offset(48, 62), framePaint);

    // Warm Sunbeam / Lamp Light through window
    final sunbeamPaint = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [(isEvening ? const Color(0xFFFF9F43) : const Color(0xFFFFF9E6)).withValues(alpha: 0.25), Colors.transparent],
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
      ..shader = const LinearGradient(colors: [Color(0xFF8D6E63), Color(0xFF5D4037)]).createShader(const Rect.fromLTWH(0, 62, 160, 28));
    canvas.drawRect(const Rect.fromLTWH(0, 62, 160, 28), counterPaint);

    // Espresso machine on counter
    final machinePaint = Paint()..color = const Color(0xFFB0BEC5);
    canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(26, 42, 28, 22), const Radius.circular(3)), machinePaint);
    // Espresso accents
    canvas.drawRect(const Rect.fromLTWH(29, 45, 12, 5), Paint()..color = const Color(0xFF37474F));

    // Coffee cup on counter
    final cupPaint = Paint()..color = const Color(0xFFF5F2FB);
    canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(62, 55, 9, 8), const Radius.circular(2)), cupPaint);

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
    canvas.drawOval(const Rect.fromLTWH(124, 56, 12, 6), Paint()..color = const Color(0xFFFFB547));
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
        ..shader = RadialGradient(colors: [(l % 2 == 0 ? const Color(0xFFFF4FA3) : const Color(0xFFFFB547)).withValues(alpha: 0.5), Colors.transparent])
            .createShader(const Rect.fromLTWH(-12, 0, 24, 24));
      canvas.drawCircle(const Offset(0, 10), 12, glowPaint);

      // Lantern body
      final lanternPaint = Paint()..color = l % 2 == 0 ? const Color(0xFFFF4FA3) : const Color(0xFFFFB547);
      canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(-5, 4, 10, 12), const Radius.circular(3)), lanternPaint);

      // Lantern rib
      canvas.drawCircle(const Offset(0, 10), 2.5, Paint()..color = const Color(0xFFFFF275));

      canvas.restore();
    }
  }

  void _drawAirport(Canvas canvas, bool isEvening) {
    // Vast glass curtain wall
    final glassPaint = Paint()..color = isEvening ? const Color(0xFF131A33) : const Color(0xFF81B0E8);
    canvas.drawRect(const Rect.fromLTWH(0, 0, 160, 68), glassPaint);

    // Distant runway
    final runwayPaint = Paint()..color = const Color(0xFF263238);
    canvas.drawRect(const Rect.fromLTWH(0, 52, 160, 16), runwayPaint);

    // Runway strobe lights
    final lightColor = (animationProgress * 3).toInt() % 2 == 0 ? const Color(0xFF45E0A6) : const Color(0xFFFFB547);
    for (int i = 0; i < 10; i++) {
      canvas.drawCircle(Offset(16.0 + i * 14.0, 56), 1.5, Paint()..color = lightColor);
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
        colors: isEvening ? [const Color(0xFF1C2237), const Color(0xFF0F1424)] : [const Color(0xFFECEFF1), const Color(0xFFCFD8DC)],
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
    canvas.drawPath(awningPath, Paint()..color = const Color(0xFFFF6B6B));

    final awning2Path = Path()
      ..moveTo(96, 48)
      ..lineTo(154, 48)
      ..lineTo(158 + wave, 56)
      ..lineTo(92 + wave, 56)
      ..close();
    canvas.drawPath(awning2Path, Paint()..color = const Color(0xFF4ECDC4));

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

  // ---------------------------------------------------------------------------------------------------------------
  // Shared pieces. The character stands in the middle (about x 55–105): the scenes keep their detail to the sides and
  // the floor, and every animation is a slow loop over [animationProgress].

  /// A wall above [floorY] and a floor below it.
  void _room(Canvas canvas, {required Color wall, required Color floor, double floorY = 70}) {
    canvas.drawRect(Rect.fromLTWH(0, 0, 160, floorY), Paint()..color = wall);
    canvas.drawRect(Rect.fromLTWH(0, floorY, 160, 90 - floorY), Paint()..color = floor);
  }

  /// Steam rising from a cup at ([x], [y]).
  void _steam(Canvas canvas, double x, double y) {
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0
      ..strokeCap = StrokeCap.round;
    for (int s = 0; s < 3; s++) {
      final t = (animationProgress + s * 0.33) % 1.0;
      final sy = y - t * 10.0;
      final sway = math.sin(t * math.pi * 3.0) * 1.6;
      paint.color = Colors.white.withValues(alpha: (1.0 - t) * 0.45);
      canvas.drawPath(
        Path()
          ..moveTo(x + s * 1.8, sy + 3)
          ..quadraticBezierTo(x + s * 1.8 + sway, sy + 1.5, x + s * 1.8 - sway, sy),
        paint,
      );
    }
  }

  /// A warm radial glow (lamps, candles), its strength breathing with [pulse] (0..1).
  void _glow(Canvas canvas, Offset center, double radius, Color color, {double pulse = 1}) {
    canvas.drawCircle(
      center,
      radius,
      Paint()
        ..shader = RadialGradient(
          colors: [
            color.withValues(alpha: 0.55 * pulse),
            Colors.transparent,
          ],
        ).createShader(Rect.fromCircle(center: center, radius: radius)),
    );
  }

  /// A potted plant whose leaves sway a little.
  void _plant(Canvas canvas, double x, double baseY, {double size = 1}) {
    canvas.drawRRect(
      RRect.fromRectAndRadius(Rect.fromLTWH(x - 4 * size, baseY - 7 * size, 8 * size, 7 * size), Radius.circular(1.5 * size)),
      Paint()..color = const Color(0xFFD9825B),
    );
    final leaf = Paint()..color = const Color(0xFF2E9E6A);
    for (int l = 0; l < 5; l++) {
      final angle = -math.pi / 2 + (l - 2) * 0.45 + math.sin(animationProgress * math.pi * 2 + l) * 0.06;
      canvas.save();
      canvas.translate(x, baseY - 7 * size);
      canvas.rotate(angle + math.pi / 2);
      canvas.drawOval(Rect.fromLTWH(-1.6 * size, -9 * size, 3.2 * size, 9 * size), leaf);
      canvas.restore();
    }
  }

  // ---------------------------------------------------------------------------------------------------------------

  /// Living room: a window with curtains in the breeze, a bookshelf, a sofa, a lamp, tea steaming, a plant.
  void _drawHome(Canvas canvas, bool isEvening) {
    _room(canvas, wall: isEvening ? const Color(0xFF2A1F3D) : const Color(0xFFF3E6D6), floor: isEvening ? const Color(0xFF33241D) : const Color(0xFFC79A6E));
    // Floorboards.
    final board = Paint()..color = (isEvening ? Colors.black : const Color(0xFF8D6440)).withValues(alpha: 0.25);
    for (int b = 0; b < 8; b++) {
      canvas.drawLine(Offset(b * 22.0, 70), Offset(b * 22.0 - 10, 90), board);
    }
    // Window and the sky behind it.
    const window = Rect.fromLTWH(10, 12, 38, 38);
    canvas.drawRect(window, Paint()..color = isEvening ? const Color(0xFF17122B) : const Color(0xFFBDE3FF));
    if (isEvening) {
      canvas.drawCircle(const Offset(38, 21), 3.5, Paint()..color = const Color(0xFFFFF3C4));
    } else {
      canvas.drawOval(const Rect.fromLTWH(16, 20, 14, 4), Paint()..color = Colors.white.withValues(alpha: 0.9));
    }
    final frame = Paint()
      ..color = const Color(0xFFFFFFFF).withValues(alpha: isEvening ? 0.25 : 0.9)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.4;
    canvas.drawRect(window, frame);
    canvas.drawLine(const Offset(29, 12), const Offset(29, 50), frame);
    canvas.drawLine(const Offset(10, 31), const Offset(48, 31), frame);
    // Curtains, moving with the breeze.
    final breeze = math.sin(animationProgress * math.pi * 2) * 1.2;
    final curtain = Paint()..color = isEvening ? const Color(0xFF6B3F6E) : const Color(0xFFE57373);
    canvas.drawPath(
      Path()
        ..moveTo(6, 9)
        ..lineTo(15, 9)
        ..quadraticBezierTo(13 + breeze, 32, 16 + breeze, 54)
        ..lineTo(6, 54)
        ..close(),
      curtain,
    );
    canvas.drawPath(
      Path()
        ..moveTo(52, 9)
        ..lineTo(43, 9)
        ..quadraticBezierTo(45 + breeze, 32, 42 + breeze, 54)
        ..lineTo(52, 54)
        ..close(),
      curtain,
    );
    canvas.drawRect(const Rect.fromLTWH(4, 8, 50, 1.6), Paint()..color = const Color(0xFF8D6E63));
    // Bookshelf.
    const shelf = Rect.fromLTWH(120, 14, 32, 56);
    canvas.drawRect(shelf, Paint()..color = isEvening ? const Color(0xFF4E342E) : const Color(0xFF8D6E63));
    final bookColors = [const Color(0xFFEF5350), const Color(0xFF42A5F5), const Color(0xFFFFCA28), const Color(0xFF66BB6A), const Color(0xFFAB47BC)];
    for (int row = 0; row < 3; row++) {
      final y = 16.0 + row * 18.0;
      canvas.drawRect(Rect.fromLTWH(121, y + 15, 30, 1.5), Paint()..color = const Color(0xFF5D4037));
      var x = 123.0;
      for (int b = 0; b < 6 && x < 148; b++) {
        final w = 2.6 + (b * 7 + row * 3) % 3;
        final h = 9.0 + (b * 5 + row * 2) % 5;
        canvas.drawRect(
          Rect.fromLTWH(x, y + 15 - h, w, h),
          Paint()..color = bookColors[(b + row * 2) % bookColors.length].withValues(alpha: isEvening ? 0.7 : 1),
        );
        x += w + 0.8;
      }
    }
    // Sofa.
    final sofa = Paint()..color = isEvening ? const Color(0xFF3B5B7A) : const Color(0xFF5C8DBF);
    canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(4, 56, 46, 18), const Radius.circular(4)), sofa);
    canvas.drawRRect(
      RRect.fromRectAndRadius(const Rect.fromLTWH(8, 60, 18, 8), const Radius.circular(3)),
      Paint()..color = const Color(0xFFFFFFFF).withValues(alpha: 0.18),
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(const Rect.fromLTWH(28, 60, 18, 8), const Radius.circular(3)),
      Paint()..color = const Color(0xFFFFFFFF).withValues(alpha: 0.18),
    );
    // Floor lamp, glowing in the evening.
    canvas.drawLine(
      const Offset(112, 34),
      const Offset(112, 70),
      Paint()
        ..color = const Color(0xFF5D4037)
        ..strokeWidth = 1.2,
    );
    canvas.drawPath(
      Path()
        ..moveTo(106, 34)
        ..lineTo(118, 34)
        ..lineTo(115, 27)
        ..lineTo(109, 27)
        ..close(),
      Paint()..color = const Color(0xFFFFE0B2),
    );
    if (isEvening) _glow(canvas, const Offset(112, 36), 18, const Color(0xFFFFB547), pulse: 0.85 + 0.15 * math.sin(animationProgress * math.pi * 2));
    // A small table with tea.
    canvas.drawRect(const Rect.fromLTWH(96, 64, 12, 2), Paint()..color = const Color(0xFF6D4C41));
    canvas.drawRect(const Rect.fromLTWH(98, 66, 1.4, 6), Paint()..color = const Color(0xFF6D4C41));
    canvas.drawRect(const Rect.fromLTWH(104.6, 66, 1.4, 6), Paint()..color = const Color(0xFF6D4C41));
    canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(99.5, 59.5, 5, 4.5), const Radius.circular(1.2)), Paint()..color = const Color(0xFFFFFFFF));
    _steam(canvas, 100.5, 58);
    _plant(canvas, 60, 72, size: 0.9);
  }

  /// Workspace: a window on the skyline (lit windows blink in the evening), a desk, a screen with a blinking cursor.
  void _drawOffice(Canvas canvas, bool isEvening) {
    _room(canvas, wall: isEvening ? const Color(0xFF1A2033) : const Color(0xFFE6ECF4), floor: isEvening ? const Color(0xFF10131F) : const Color(0xFFB7C3D0));
    // Window with the skyline.
    const window = Rect.fromLTWH(6, 8, 68, 46);
    canvas.drawRect(window, Paint()..color = isEvening ? const Color(0xFF151A36) : const Color(0xFF9FD0FF));
    final towers = [(8.0, 30.0, 10.0), (19.0, 22.0, 9.0), (29.0, 34.0, 12.0), (42.0, 18.0, 9.0), (52.0, 28.0, 11.0), (64.0, 24.0, 9.0)];
    final tower = Paint()..color = isEvening ? const Color(0xFF242B4D) : const Color(0xFF6C8AAE);
    for (final (x, top, w) in towers) {
      canvas.drawRect(Rect.fromLTWH(x, top, w, 54 - top), tower);
    }
    final lit = Paint()..color = const Color(0xFFFFD27A);
    for (int i = 0; i < 14; i++) {
      final (x, top, w) = towers[i % towers.length];
      final wy = top + 3 + (i * 7 % 18);
      if (wy > 51) continue;
      final on = !isEvening || math.sin(animationProgress * math.pi * 2 * (1 + i % 3) + i) > -0.3;
      if (on) {
        canvas.drawRect(
          Rect.fromLTWH(x + 2 + (i * 3 % (w - 4).floor()), wy, 1.8, 1.8),
          lit..color = const Color(0xFFFFD27A).withValues(alpha: isEvening ? 0.9 : 0.35),
        );
      }
    }
    final frame = Paint()
      ..color = const Color(0xFFFFFFFF).withValues(alpha: isEvening ? 0.2 : 0.85)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.4;
    canvas.drawRect(window, frame);
    canvas.drawLine(const Offset(40, 8), const Offset(40, 54), frame);
    // Desk.
    final wood = Paint()..color = isEvening ? const Color(0xFF5A4636) : const Color(0xFFB08968);
    canvas.drawRect(const Rect.fromLTWH(92, 62, 64, 3), wood);
    canvas.drawRect(const Rect.fromLTWH(95, 65, 2, 12), wood);
    canvas.drawRect(const Rect.fromLTWH(151, 65, 2, 12), wood);
    // Screen, its glow and a blinking cursor.
    canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(112, 42, 28, 18), const Radius.circular(1.5)), Paint()..color = const Color(0xFF263238));
    canvas.drawRect(const Rect.fromLTWH(114, 44, 24, 14), Paint()..color = isEvening ? const Color(0xFF2E5BFF) : const Color(0xFF64B5F6));
    for (int line = 0; line < 3; line++) {
      canvas.drawRect(Rect.fromLTWH(116, 46.5 + line * 3.5, 12.0 + (line * 5 % 8), 1.2), Paint()..color = Colors.white.withValues(alpha: 0.7));
    }
    if ((animationProgress * 4).floor().isEven) canvas.drawRect(const Rect.fromLTWH(130, 53.5, 1, 2.4), Paint()..color = Colors.white);
    canvas.drawRect(const Rect.fromLTWH(124, 60, 4, 2), Paint()..color = const Color(0xFF263238));
    if (isEvening) _glow(canvas, const Offset(126, 50), 16, const Color(0xFF5C8BFF), pulse: 0.6);
    // Desk lamp and a mug.
    canvas.drawLine(
      const Offset(148, 62),
      const Offset(146, 50),
      Paint()
        ..color = const Color(0xFF455A64)
        ..strokeWidth = 1.2,
    );
    canvas.drawPath(
      Path()
        ..moveTo(143, 50)
        ..lineTo(151, 50)
        ..lineTo(149, 46)
        ..lineTo(145, 46)
        ..close(),
      Paint()..color = const Color(0xFFFFB547),
    );
    if (isEvening) _glow(canvas, const Offset(147, 54), 12, const Color(0xFFFFB547));
    canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(100, 57, 5, 5), const Radius.circular(1.2)), Paint()..color = const Color(0xFFEF5350));
    _steam(canvas, 101, 55);
    _plant(canvas, 82, 72);
  }

  /// A carriage: scenery slides past the panoramic windows, seats in rows, hand straps swaying.
  void _drawTransit(Canvas canvas, bool isEvening) {
    _room(
      canvas,
      wall: isEvening ? const Color(0xFF1E2238) : const Color(0xFFDDE3EA),
      floor: isEvening ? const Color(0xFF151827) : const Color(0xFF90A4AE),
      floorY: 74,
    );
    for (final x in [6.0, 86.0]) {
      final pane = Rect.fromLTWH(x, 14, 68, 32);
      canvas.save();
      canvas.clipRRect(RRect.fromRectAndRadius(pane, const Radius.circular(4)));
      canvas.drawRect(pane, Paint()..color = isEvening ? const Color(0xFF141936) : const Color(0xFFA9D8FF));
      // Hills and poles slide left: the train moves.
      final shift = animationProgress * 160.0;
      final hills = Path()..moveTo(x, 46);
      for (double hx = x; hx <= x + 68; hx += 2) {
        hills.lineTo(hx, 36 + math.sin((hx + shift) / 9.0) * 3.0 + math.sin((hx + shift) / 4.0) * 1.0);
      }
      hills
        ..lineTo(x + 68, 46)
        ..close();
      canvas.drawPath(hills, Paint()..color = isEvening ? const Color(0xFF243055) : const Color(0xFF7CC08C));
      for (int p = 0; p < 4; p++) {
        final px = x + ((p * 40.0 - shift * 2.0) % 160.0 + 160.0) % 160.0 - 40.0;
        canvas.drawRect(Rect.fromLTWH(px, 24, 1.2, 22), Paint()..color = isEvening ? const Color(0xFF3B4366) : const Color(0xFF5F6B7A));
      }
      if (isEvening) {
        for (int l = 0; l < 5; l++) {
          final lx = x + ((l * 31.0 - shift * 0.6) % 68.0 + 68.0) % 68.0;
          canvas.drawCircle(Offset(lx, 38), 0.9, Paint()..color = const Color(0xFFFFD27A));
        }
      }
      canvas.restore();
      canvas.drawRRect(
        RRect.fromRectAndRadius(pane, const Radius.circular(4)),
        Paint()
          ..color = isEvening ? const Color(0xFF3A4060) : const Color(0xFFB0BEC5)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.6,
      );
    }
    // Handrail with swaying straps.
    canvas.drawLine(
      const Offset(0, 8),
      const Offset(160, 8),
      Paint()
        ..color = const Color(0xFF9E9E9E)
        ..strokeWidth = 1.2,
    );
    for (int s = 0; s < 6; s++) {
      final sx = 12.0 + s * 28.0;
      canvas.save();
      canvas.translate(sx, 8);
      canvas.rotate(math.sin(animationProgress * math.pi * 2 + s * 0.7) * 0.12);
      canvas.drawLine(
        Offset.zero,
        const Offset(0, 6),
        Paint()
          ..color = const Color(0xFF9E9E9E)
          ..strokeWidth = 0.8,
      );
      canvas.drawOval(
        const Rect.fromLTWH(-2, 6, 4, 4),
        Paint()
          ..color = const Color(0xFFFFB547)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 0.9,
      );
      canvas.restore();
    }
    // Seats.
    final seat = Paint()..color = isEvening ? const Color(0xFF2B6E7A) : const Color(0xFF26A69A);
    for (final x in [4.0, 26.0, 116.0, 138.0]) {
      canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTWH(x, 52, 18, 12), const Radius.circular(3)), seat);
      canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTWH(x, 63, 18, 6), const Radius.circular(2)), seat);
    }
    canvas.drawRect(const Rect.fromLTWH(0, 73, 160, 1.4), Paint()..color = const Color(0xFFFFCA28).withValues(alpha: 0.7));
  }

  /// Dining room: an arched window on the courtyard, pendant lamps, tables with flickering candles.
  void _drawRestaurant(Canvas canvas, bool isEvening) {
    _room(canvas, wall: isEvening ? const Color(0xFF2B1B2E) : const Color(0xFFF4E3CF), floor: isEvening ? const Color(0xFF1E1418) : const Color(0xFFA1694B));
    // Arched window with the courtyard's greenery.
    final arch = Path()
      ..moveTo(10, 54)
      ..lineTo(10, 26)
      ..arcToPoint(const Offset(44, 26), radius: const Radius.circular(17))
      ..lineTo(44, 54)
      ..close();
    canvas.drawPath(arch, Paint()..color = isEvening ? const Color(0xFF1A1533) : const Color(0xFFBFE6FF));
    canvas.save();
    canvas.clipPath(arch);
    for (int b = 0; b < 4; b++) {
      canvas.drawCircle(Offset(14.0 + b * 9, 50), 7, Paint()..color = isEvening ? const Color(0xFF1F3B2E) : const Color(0xFF66BB6A));
    }
    canvas.restore();
    canvas.drawPath(
      arch,
      Paint()
        ..color = isEvening ? const Color(0xFF6D4C41) : const Color(0xFFFFFFFF)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.6,
    );
    // Pendant lamps, swaying slightly.
    for (final (i, x) in [128.0, 148.0].indexed) {
      final sway = math.sin(animationProgress * math.pi * 2 + i) * 0.05;
      canvas.save();
      canvas.translate(x, 0);
      canvas.rotate(sway);
      canvas.drawLine(
        Offset.zero,
        const Offset(0, 14),
        Paint()
          ..color = const Color(0xFF5D4037)
          ..strokeWidth = 0.8,
      );
      canvas.drawPath(
        Path()
          ..moveTo(-5, 19)
          ..lineTo(5, 19)
          ..lineTo(2.5, 14)
          ..lineTo(-2.5, 14)
          ..close(),
        Paint()..color = const Color(0xFFFFB547),
      );
      _glow(canvas, const Offset(0, 21), isEvening ? 14 : 8, const Color(0xFFFFC048), pulse: isEvening ? 1 : 0.5);
      canvas.restore();
    }
    // Tables with white cloths and candles.
    for (final x in [4.0, 116.0]) {
      canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTWH(x, 60, 40, 5), const Radius.circular(1.5)), Paint()..color = const Color(0xFFFAFAFA));
      canvas.drawRect(Rect.fromLTWH(x + 2, 65, 36, 7), Paint()..color = const Color(0xFFECEFF1));
      final cx = x + 20;
      canvas.drawRect(Rect.fromLTWH(cx - 1, 54, 2, 6), Paint()..color = const Color(0xFFFFF8E1));
      final flicker = 0.8 + 0.2 * math.sin(animationProgress * math.pi * 8 + x);
      canvas.drawOval(Rect.fromCenter(center: Offset(cx, 52.5), width: 2.2 * flicker, height: 3.4 * flicker), Paint()..color = const Color(0xFFFFB300));
      _glow(canvas, Offset(cx, 52), isEvening ? 10 : 5, const Color(0xFFFFB300), pulse: flicker);
      canvas.drawCircle(Offset(cx - 10, 58.5), 1.6, Paint()..color = const Color(0xFFB71C1C).withValues(alpha: 0.85));
      canvas.drawCircle(Offset(cx + 10, 58.5), 1.6, Paint()..color = const Color(0xFFB71C1C).withValues(alpha: 0.85));
    }
  }

  /// Rooftop terrace: string lights twinkling over the skyline, a parapet, a bench and a planter.
  void _drawGathering(Canvas canvas, bool isEvening) {
    if (!isEvening) {
      // Low sun.
      _glow(canvas, const Offset(128, 44), 26, const Color(0xFFFF8A65));
      canvas.drawCircle(const Offset(128, 44), 7, Paint()..color = const Color(0xFFFFB74D));
    }
    final skyline = Paint()..color = isEvening ? const Color(0xFF231B3F) : const Color(0xFF7E7FB0);
    for (final (x, top, w) in [
      (0.0, 40.0, 14.0),
      (16.0, 34.0, 10.0),
      (30.0, 44.0, 16.0),
      (100.0, 38.0, 12.0),
      (114.0, 46.0, 18.0),
      (136.0, 36.0, 12.0),
      (150.0, 42.0, 10.0),
    ]) {
      canvas.drawRect(Rect.fromLTWH(x, top, w, 62 - top), skyline);
    }
    // Deck and parapet.
    canvas.drawRect(const Rect.fromLTWH(0, 62, 160, 28), Paint()..color = isEvening ? const Color(0xFF3E2C26) : const Color(0xFFA1887F));
    final plank = Paint()..color = Colors.black.withValues(alpha: 0.18);
    for (int p = 0; p < 6; p++) {
      canvas.drawLine(Offset(0, 66.0 + p * 4), Offset(160, 66.0 + p * 4), plank);
    }
    canvas.drawRect(const Rect.fromLTWH(0, 58, 160, 4), Paint()..color = isEvening ? const Color(0xFF5D4E75) : const Color(0xFFD7CCC8));
    // String lights in two swags.
    for (final (y0, sag) in [(6.0, 12.0), (14.0, 9.0)]) {
      final wire = Path()
        ..moveTo(0, y0)
        ..quadraticBezierTo(80, y0 + sag * 2, 160, y0);
      canvas.drawPath(
        wire,
        Paint()
          ..color = const Color(0xFF4A4E69)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 0.6,
      );
      for (int b = 0; b < 12; b++) {
        final t = (b + 0.5) / 12;
        final bx = 160 * t;
        final by = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * (y0 + sag * 2) + t * t * y0 + 1.5;
        final twinkle = 0.55 + 0.45 * math.sin(animationProgress * math.pi * 2 * 2 + b * 1.3 + y0);
        final color = [const Color(0xFFFFE082), const Color(0xFFFF8A80), const Color(0xFF80D8FF)][b % 3];
        if (isEvening) _glow(canvas, Offset(bx, by), 4, color, pulse: twinkle);
        canvas.drawCircle(Offset(bx, by), 1.1, Paint()..color = color.withValues(alpha: isEvening ? twinkle : 0.8));
      }
    }
    // Bench and planter.
    final wood = Paint()..color = const Color(0xFF8D6E63);
    canvas.drawRect(const Rect.fromLTWH(6, 68, 34, 3), wood);
    canvas.drawRect(const Rect.fromLTWH(6, 63, 34, 2), wood);
    canvas.drawRect(const Rect.fromLTWH(9, 71, 2, 6), wood);
    canvas.drawRect(const Rect.fromLTWH(35, 71, 2, 6), wood);
    canvas.drawRect(const Rect.fromLTWH(124, 66, 30, 9), Paint()..color = const Color(0xFF6D4C41));
    for (int l = 0; l < 4; l++) {
      _plant(canvas, 128.0 + l * 7.5, 67, size: 0.7);
    }
  }

  /// Station hall: a glass-and-iron arch, a platform clock ticking round, a departure board flipping, the tracks.
  void _drawStation(Canvas canvas, bool isEvening) {
    _room(
      canvas,
      wall: isEvening ? const Color(0xFF1C1A2E) : const Color(0xFFD9CBB8),
      floor: isEvening ? const Color(0xFF14121F) : const Color(0xFF9E9E9E),
      floorY: 66,
    );
    // Glass arch and its iron ribs.
    final archRect = const Rect.fromLTWH(-10, 2, 180, 76);
    canvas.drawArc(archRect, math.pi, math.pi, true, Paint()..color = isEvening ? const Color(0xFF231F44) : const Color(0xFFCFE8FF));
    final iron = Paint()
      ..color = isEvening ? const Color(0xFF4B4669) : const Color(0xFF6D7B8A)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2;
    canvas.drawArc(archRect, math.pi, math.pi, false, iron);
    for (int r = 1; r < 8; r++) {
      final a = math.pi + r * math.pi / 8;
      canvas.drawLine(const Offset(80, 40), Offset(80 + math.cos(a) * 90, 40 + math.sin(a) * 38), iron);
    }
    canvas.drawRect(const Rect.fromLTWH(0, 40, 160, 26), Paint()..color = isEvening ? const Color(0xFF2A2440) : const Color(0xFFC8B79E));
    // Platform clock: the minute hand goes round once a loop.
    const clock = Offset(26, 50);
    canvas.drawLine(
      const Offset(26, 40),
      const Offset(26, 45),
      Paint()
        ..color = const Color(0xFF424242)
        ..strokeWidth = 1,
    );
    canvas.drawCircle(clock, 6, Paint()..color = const Color(0xFFFAFAFA));
    canvas.drawCircle(
      clock,
      6,
      Paint()
        ..color = const Color(0xFF424242)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1,
    );
    final minute = animationProgress * math.pi * 2 - math.pi / 2;
    final hour = animationProgress * math.pi * 2 / 12 + math.pi / 3;
    final hand = Paint()
      ..color = const Color(0xFF212121)
      ..strokeWidth = 0.8
      ..strokeCap = StrokeCap.round;
    canvas.drawLine(clock, clock + Offset(math.cos(minute) * 4.6, math.sin(minute) * 4.6), hand);
    canvas.drawLine(clock, clock + Offset(math.cos(hour) * 3, math.sin(hour) * 3), hand..strokeWidth = 1.1);
    // Departure board: its rows flip now and then.
    canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(112, 44, 40, 16), const Radius.circular(1.5)), Paint()..color = const Color(0xFF1B1B1B));
    final flip = (animationProgress * 3).floor();
    for (int row = 0; row < 3; row++) {
      final w1 = 6.0 + ((row + flip) * 5 % 9);
      canvas.drawRect(Rect.fromLTWH(115, 47.0 + row * 4, w1, 1.6), Paint()..color = const Color(0xFFFFB300));
      canvas.drawRect(Rect.fromLTWH(115 + w1 + 3, 47.0 + row * 4, 10, 1.6), Paint()..color = const Color(0xFFFFE082).withValues(alpha: 0.7));
      canvas.drawRect(Rect.fromLTWH(144, 47.0 + row * 4, 5, 1.6), Paint()..color = const Color(0xFF69F0AE));
    }
    // Platform edge and tracks.
    canvas.drawRect(const Rect.fromLTWH(0, 66, 160, 2), Paint()..color = const Color(0xFFFFD54F));
    canvas.drawRect(const Rect.fromLTWH(0, 74, 160, 16), Paint()..color = isEvening ? const Color(0xFF0E0C16) : const Color(0xFF5D5D5D));
    final rail = Paint()
      ..color = const Color(0xFFB0BEC5)
      ..strokeWidth = 1;
    canvas.drawLine(const Offset(0, 78), const Offset(160, 78), rail);
    canvas.drawLine(const Offset(0, 84), const Offset(160, 84), rail);
    for (int t = 0; t < 16; t++) {
      canvas.drawRect(Rect.fromLTWH(t * 10.0 + 2, 77, 4, 8), Paint()..color = const Color(0xFF6D4C41).withValues(alpha: 0.6));
    }
  }

  /// City garden: cherry trees letting petals fall, a path, a bench, a lamp post.
  void _drawPark(Canvas canvas, bool isEvening) {
    // Distant trees.
    for (int t = 0; t < 6; t++) {
      canvas.drawCircle(Offset(10.0 + t * 28, 54), 13, Paint()..color = isEvening ? const Color(0xFF1C3328) : const Color(0xFF8BC79A));
    }
    // Lawn and path.
    canvas.drawRect(const Rect.fromLTWH(0, 60, 160, 30), Paint()..color = isEvening ? const Color(0xFF173024) : const Color(0xFF7BC67E));
    canvas.drawPath(
      Path()
        ..moveTo(70, 90)
        ..quadraticBezierTo(86, 74, 130, 62)
        ..lineTo(140, 62)
        ..quadraticBezierTo(100, 76, 98, 90)
        ..close(),
      Paint()..color = isEvening ? const Color(0xFF4A4038) : const Color(0xFFE8D8B5),
    );
    // Cherry trees.
    for (final (x, scale) in [(18.0, 1.0), (146.0, 0.8)]) {
      canvas.drawRect(Rect.fromLTWH(x - 2 * scale, 36, 4 * scale, 30), Paint()..color = const Color(0xFF6D4C41));
      for (final (dx, dy, r) in [(-9.0, 30.0, 10.0), (0.0, 24.0, 12.0), (9.0, 30.0, 10.0), (-4.0, 34.0, 9.0), (5.0, 35.0, 9.0)]) {
        canvas.drawCircle(Offset(x + dx * scale, dy), r * scale, Paint()..color = isEvening ? const Color(0xFF8E4B70) : const Color(0xFFF8BBD0));
      }
    }
    // Falling petals.
    final petal = Paint()..color = isEvening ? const Color(0xFFD48BB0) : const Color(0xFFF48FB1);
    for (int p = 0; p < 9; p++) {
      final t = (animationProgress + p / 9) % 1.0;
      final px = (p < 5 ? 10.0 : 132.0) + (p % 5) * 6 + math.sin(t * math.pi * 4 + p) * 3;
      final py = 30 + t * 44;
      canvas.save();
      canvas.translate(px, py);
      canvas.rotate(t * math.pi * 2);
      canvas.drawOval(const Rect.fromLTWH(-1.2, -0.7, 2.4, 1.4), petal..color = petal.color.withValues(alpha: 1 - t * 0.6));
      canvas.restore();
    }
    // Bench and lamp post.
    final bench = Paint()..color = const Color(0xFF795548);
    canvas.drawRect(const Rect.fromLTWH(104, 64, 22, 2.4), bench);
    canvas.drawRect(const Rect.fromLTWH(104, 59.5, 22, 2), bench);
    canvas.drawRect(const Rect.fromLTWH(106, 66, 1.6, 5), Paint()..color = const Color(0xFF37474F));
    canvas.drawRect(const Rect.fromLTWH(122, 66, 1.6, 5), Paint()..color = const Color(0xFF37474F));
    canvas.drawRect(const Rect.fromLTWH(43, 34, 1.6, 34), Paint()..color = const Color(0xFF37474F));
    canvas.drawCircle(const Offset(43.8, 33), 2.6, Paint()..color = isEvening ? const Color(0xFFFFE082) : const Color(0xFFECEFF1));
    if (isEvening) _glow(canvas, const Offset(43.8, 33), 14, const Color(0xFFFFE082), pulse: 0.9 + 0.1 * math.sin(animationProgress * math.pi * 2));
  }

  /// Clinic: a window on the indoor garden, a green cross glowing softly, the reception desk, chairs, a water cooler.
  void _drawClinic(Canvas canvas, bool isEvening) {
    _room(canvas, wall: isEvening ? const Color(0xFF16242A) : const Color(0xFFE6F3F0), floor: isEvening ? const Color(0xFF0F1A1E) : const Color(0xFFC9DCD7));
    canvas.drawRect(const Rect.fromLTWH(0, 46, 160, 24), Paint()..color = (isEvening ? const Color(0xFF203239) : const Color(0xFFD4E8E3)));
    // Window on the garden.
    const window = Rect.fromLTWH(8, 10, 38, 30);
    canvas.drawRect(window, Paint()..color = isEvening ? const Color(0xFF172C33) : const Color(0xFFBFE9DD));
    canvas.save();
    canvas.clipRect(window);
    for (int l = 0; l < 6; l++) {
      final sway = math.sin(animationProgress * math.pi * 2 + l) * 0.08;
      canvas.save();
      canvas.translate(10.0 + l * 7, 40);
      canvas.rotate(-0.4 + l * 0.16 + sway);
      canvas.drawOval(const Rect.fromLTWH(-2.5, -16, 5, 16), Paint()..color = isEvening ? const Color(0xFF2D5A47) : const Color(0xFF43A047));
      canvas.restore();
    }
    canvas.restore();
    canvas.drawRect(
      window,
      Paint()
        ..color = Colors.white.withValues(alpha: isEvening ? 0.2 : 0.9)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.4,
    );
    // The green cross, glowing softly.
    final pulse = 0.75 + 0.25 * math.sin(animationProgress * math.pi * 2);
    _glow(canvas, const Offset(132, 22), 12, const Color(0xFF00E676), pulse: pulse * (isEvening ? 1 : 0.5));
    final cross = Paint()..color = const Color(0xFF00C853);
    canvas.drawRect(const Rect.fromLTWH(129.5, 15, 5, 14), cross);
    canvas.drawRect(const Rect.fromLTWH(125, 19.5, 14, 5), cross);
    // Reception desk with a screen.
    canvas.drawRRect(
      RRect.fromRectAndRadius(const Rect.fromLTWH(108, 54, 48, 18), const Radius.circular(2)),
      Paint()..color = isEvening ? const Color(0xFF6D5A4B) : const Color(0xFFD7B899),
    );
    canvas.drawRect(const Rect.fromLTWH(108, 54, 48, 2.4), Paint()..color = isEvening ? const Color(0xFF8D7A68) : const Color(0xFFEAD6BE));
    canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(138, 45, 12, 9), const Radius.circular(1)), Paint()..color = const Color(0xFF37474F));
    canvas.drawRect(const Rect.fromLTWH(139, 46, 10, 7), Paint()..color = const Color(0xFF80CBC4));
    // Waiting chairs.
    final chair = Paint()..color = isEvening ? const Color(0xFF26667A) : const Color(0xFF4DB6AC);
    for (int c = 0; c < 3; c++) {
      canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTWH(6.0 + c * 13, 58, 11, 9), const Radius.circular(2)), chair);
      canvas.drawRect(Rect.fromLTWH(8.0 + c * 13, 67, 1.2, 4), Paint()..color = const Color(0xFF546E7A));
      canvas.drawRect(Rect.fromLTWH(14.6 + c * 13, 67, 1.2, 4), Paint()..color = const Color(0xFF546E7A));
    }
    // Water cooler: a bubble rises now and then.
    canvas.drawRRect(
      RRect.fromRectAndRadius(const Rect.fromLTWH(48, 46, 8, 10), const Radius.circular(2.5)),
      Paint()..color = const Color(0xFF81D4FA).withValues(alpha: 0.85),
    );
    canvas.drawRect(const Rect.fromLTWH(47, 56, 10, 14), Paint()..color = const Color(0xFFECEFF1));
    final t = animationProgress % 1.0;
    canvas.drawCircle(Offset(52 + math.sin(t * math.pi * 4) * 1.2, 55 - t * 8), 0.9, Paint()..color = Colors.white.withValues(alpha: 1 - t));
  }

  @override
  bool shouldRepaint(covariant ScenePainter oldDelegate) {
    return oldDelegate.animationProgress != animationProgress ||
        oldDelegate.sceneId != sceneId ||
        oldDelegate.variant != variant ||
        oldDelegate.parallaxOffset != parallaxOffset;
  }
}
