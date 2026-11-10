import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'melo_model.dart';

class MeloPainter extends CustomPainter {
  final MeloState state;
  final MeloTint tint;
  final double breath; // 0..1 breathing cycle
  final double blink; // 0..1 eye blink
  final double tailWag; // -1..1 tail wag
  final Offset leftGaze; // -1..1 pupil offset
  final Offset rightGaze; // -1..1 pupil offset
  final double mouthOpen; // 0..1
  final double tongueFlick; // 0..1

  MeloPainter({
    required this.state,
    required this.tint,
    required this.breath,
    required this.blink,
    required this.tailWag,
    required this.leftGaze,
    required this.rightGaze,
    this.mouthOpen = 0.0,
    this.tongueFlick = 0.0,
  });

  @override
  void paint(Canvas canvas, Size size) {
    // Coordinate space: 100 x 100 viewBox
    final double scale = math.min(size.width, size.height) / 100.0;
    canvas.save();
    canvas.translate(
      (size.width - 100.0 * scale) / 2.0,
      (size.height - 100.0 * scale) / 2.0,
    );
    canvas.scale(scale);

    final breathScale = 1.0 + (breath * 0.035);
    final breathY = -breath * 1.5;

    // --- 1. Tail (spiraling polygon attached to lower-right) ---
    _drawTail(canvas, breathScale, tailWag);

    // --- 2. Feet / Stubby mitten limbs ---
    _drawFeet(canvas, breathY);

    // --- 3. Pear Body with Head ---
    _drawBody(canvas, breathScale, breathY);

    // --- 4. Saffron Crest (3 rounded bumps on top of head) ---
    _drawCrest(canvas, breathY);

    // --- 5. Belly Patch ---
    _drawBelly(canvas, breathScale, breathY);

    // --- 6. Cheeks ---
    _drawCheeks(canvas, breathY);

    // --- 7. Eye Turrets (swivel independently like real chameleon) ---
    _drawEyeTurret(canvas, const Offset(33, 42), leftGaze, blink, breathY);
    _drawEyeTurret(canvas, const Offset(67, 42), rightGaze, blink, breathY);

    // --- 8. Mouth & Tongue ---
    _drawMouth(canvas, breathY, mouthOpen, tongueFlick);

    canvas.restore();
  }

  void _drawTail(Canvas canvas, double breathScale, double wag) {
    final tailPaint = Paint()
      ..color = tint.bodyShade
      ..style = PaintingStyle.fill
      ..isAntiAlias = true;

    final tailPath = Path();
    // Spiral tail anchored at (74, 76)
    final anchor = const Offset(74, 76);
    tailPath.moveTo(anchor.dx, anchor.dy);

    final c1 = Offset(88 + wag * 4, 70 - wag * 3);
    final c2 = Offset(94 + wag * 6, 85 + wag * 5);
    final end = Offset(84 + wag * 8, 92 + wag * 2);

    tailPath.quadraticBezierTo(c1.dx, c1.dy, c2.dx, c2.dy);
    tailPath.quadraticBezierTo(end.dx + 4, end.dy + 4, end.dx, end.dy);
    tailPath.quadraticBezierTo(c2.dx - 4, c2.dy - 3, c1.dx - 3, c1.dy + 3);
    tailPath.close();

    canvas.drawPath(tailPath, tailPaint);

    // Spiral swirl accent
    final swirlPaint = Paint()
      ..color = tint.body
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.0
      ..strokeCap = StrokeCap.round;
    canvas.drawArc(
      Rect.fromCircle(center: Offset(84 + wag * 6, 84 + wag * 2), radius: 5),
      0,
      math.pi * 1.5,
      false,
      swirlPaint,
    );
  }

  void _drawFeet(Canvas canvas, double breathY) {
    final limbPaint = Paint()
      ..color = tint.bodyShade
      ..style = PaintingStyle.fill;

    // Left foot
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromCenter(center: Offset(32, 88 + breathY * 0.3), width: 14, height: 7),
        const Radius.circular(3.5),
      ),
      limbPaint,
    );

    // Right foot
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromCenter(center: Offset(68, 88 + breathY * 0.3), width: 14, height: 7),
        const Radius.circular(3.5),
      ),
      limbPaint,
    );
  }

  void _drawBody(Canvas canvas, double breathScale, double breathY) {
    final bodyCenter = Offset(50, 56 + breathY);
    final bodyRect = Rect.fromCenter(
      center: bodyCenter,
      width: 58 * breathScale,
      height: 64 * breathScale,
    );

    final bodyPaint = Paint()
      ..shader = RadialGradient(
        center: const Alignment(-0.25, -0.35),
        radius: 0.85,
        colors: [tint.body, tint.bodyShade],
      ).createShader(bodyRect)
      ..style = PaintingStyle.fill;

    final bodyPath = Path();
    // Pear-shaped body (head merges directly with body)
    bodyPath.moveTo(50, 18 + breathY);
    // Right crown to right cheek
    bodyPath.cubicTo(
      68, 18 + breathY,
      78 * breathScale, 38 + breathY,
      78 * breathScale, 58 + breathY,
    );
    // Right flank to ground
    bodyPath.cubicTo(
      78 * breathScale, 78 + breathY,
      68, 88 + breathY,
      50, 88 + breathY,
    );
    // Left ground to left flank
    bodyPath.cubicTo(
      32, 88 + breathY,
      22 / breathScale, 78 + breathY,
      22 / breathScale, 58 + breathY,
    );
    // Left cheek to crown
    bodyPath.cubicTo(
      22 / breathScale, 38 + breathY,
      32, 18 + breathY,
      50, 18 + breathY,
    );
    bodyPath.close();

    canvas.drawPath(bodyPath, bodyPaint);
  }

  void _drawCrest(Canvas canvas, double breathY) {
    final crestPaint = Paint()
      ..color = tint.crest
      ..style = PaintingStyle.fill;

    // 3 saffron bumps on top crown (y ~ 18)
    canvas.drawCircle(Offset(42, 18 + breathY), 4.5, crestPaint);
    canvas.drawCircle(Offset(50, 15 + breathY), 5.5, crestPaint);
    canvas.drawCircle(Offset(58, 18 + breathY), 4.5, crestPaint);
  }

  void _drawBelly(Canvas canvas, double breathScale, double breathY) {
    final bellyPaint = Paint()
      ..color = tint.belly.withValues(alpha: 0.85)
      ..style = PaintingStyle.fill;

    final bellyRect = Rect.fromCenter(
      center: Offset(50, 68 + breathY),
      width: 32 * breathScale,
      height: 28 * breathScale,
    );

    canvas.drawOval(bellyRect, bellyPaint);
  }

  void _drawCheeks(Canvas canvas, double breathY) {
    final cheekPaint = Paint()
      ..color = tint.cheek.withValues(alpha: 0.55)
      ..style = PaintingStyle.fill;

    canvas.drawOval(
      Rect.fromCenter(center: Offset(26, 52 + breathY), width: 7, height: 4.5),
      cheekPaint,
    );
    canvas.drawOval(
      Rect.fromCenter(center: Offset(74, 52 + breathY), width: 7, height: 4.5),
      cheekPaint,
    );
  }

  void _drawEyeTurret(
    Canvas canvas,
    Offset pos,
    Offset gaze,
    double blink,
    double breathY,
  ) {
    final turretCenter = Offset(pos.dx, pos.dy + breathY);
    const radius = 11.0;

    // 1. Turret outer dome
    final turretPaint = Paint()
      ..color = tint.body
      ..style = PaintingStyle.fill;
    canvas.drawCircle(turretCenter, radius, turretPaint);

    final turretShade = Paint()
      ..color = tint.bodyShade.withValues(alpha: 0.4)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2;
    canvas.drawCircle(turretCenter, radius, turretShade);

    // 2. White Sclera
    final scleraPaint = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.fill;
    canvas.drawCircle(turretCenter, radius * 0.72, scleraPaint);

    // 3. Pupil with gaze tracking
    final pupilOffset = turretCenter + Offset(gaze.dx * 3.5, gaze.dy * 3.5);
    final pupilPaint = Paint()
      ..color = const Color(0xFF130F21)
      ..style = PaintingStyle.fill;
    canvas.drawCircle(pupilOffset, 3.2, pupilPaint);

    // Catchlight in pupil
    final catchlightPaint = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.fill;
    canvas.drawCircle(pupilOffset + const Offset(-1.0, -1.0), 1.0, catchlightPaint);

    // 4. Eyelid blink
    if (blink > 0.05) {
      final lidPaint = Paint()
        ..color = tint.body
        ..style = PaintingStyle.fill;
      final lidRect = Rect.fromCircle(center: turretCenter, radius: radius);
      canvas.save();
      canvas.clipRRect(RRect.fromRectAndRadius(lidRect, Radius.circular(radius)));
      canvas.drawRect(
        Rect.fromLTWH(
          turretCenter.dx - radius,
          turretCenter.dy - radius,
          radius * 2,
          radius * 2 * blink,
        ),
        lidPaint,
      );
      canvas.restore();
    }
  }

  void _drawMouth(Canvas canvas, double breathY, double mouthOpen, double tongueFlick) {
    if (state == MeloState.happy || state == MeloState.celebrate) {
      // Big happy open smile
      final mouthPath = Path();
      mouthPath.moveTo(42, 57 + breathY);
      mouthPath.quadraticBezierTo(50, 66 + breathY, 58, 57 + breathY);
      mouthPath.close();

      canvas.drawPath(
        mouthPath,
        Paint()
          ..color = const Color(0xFF2A0718)
          ..style = PaintingStyle.fill,
      );

      // Tongue flick
      if (tongueFlick > 0.05) {
        final tonguePath = Path();
        tonguePath.moveTo(47, 61 + breathY);
        tonguePath.cubicTo(
          48, 64 + tongueFlick * 10 + breathY,
          52, 64 + tongueFlick * 10 + breathY,
          53, 61 + breathY,
        );
        canvas.drawPath(
          tonguePath,
          Paint()
            ..color = const Color(0xFFFF4FA3)
            ..style = PaintingStyle.fill,
        );
      }
    } else if (state == MeloState.curious || state == MeloState.thinking) {
      // Cute inquisitive little 'O' mouth
      canvas.drawOval(
        Rect.fromCenter(center: Offset(50, 59 + breathY), width: 5.5, height: 6),
        Paint()
          ..color = const Color(0xFF2A0718)
          ..style = PaintingStyle.fill,
      );
    } else {
      // Sweet gentle smile curve
      final smilePaint = Paint()
        ..color = const Color(0xFF2A0718)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.2
        ..strokeCap = StrokeCap.round;

      final smilePath = Path();
      smilePath.moveTo(43, 58 + breathY);
      smilePath.quadraticBezierTo(50, 62 + breathY, 57, 58 + breathY);
      canvas.drawPath(smilePath, smilePaint);
    }
  }

  @override
  bool shouldRepaint(covariant MeloPainter oldDelegate) {
    return oldDelegate.breath != breath ||
        oldDelegate.blink != blink ||
        oldDelegate.tailWag != tailWag ||
        oldDelegate.leftGaze != leftGaze ||
        oldDelegate.rightGaze != rightGaze ||
        oldDelegate.state != state ||
        oldDelegate.tint != tint ||
        oldDelegate.mouthOpen != mouthOpen ||
        oldDelegate.tongueFlick != tongueFlick;
  }
}
