import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'motion.dart';

/// A burst of confetti, played once when it appears (a mission completed, a call's goals met, a lesson heard to the
/// end). Decorative: it takes no taps and says nothing to screen readers, and with reduced motion it is not drawn.
class ConfettiBurst extends StatefulWidget {
  const ConfettiBurst({
    super.key,
    required this.colors,
    this.count = 70,
    this.origin = const Alignment(0, -0.35),
    this.duration = const Duration(milliseconds: 2200),
    this.seed = 7,
  });

  final List<Color> colors;
  final int count;

  /// Where the burst starts, in the box it fills.
  final Alignment origin;
  final Duration duration;
  final int seed;

  @override
  State<ConfettiBurst> createState() => _ConfettiBurstState();
}

class _ConfettiBurstState extends State<ConfettiBurst> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(vsync: this, duration: widget.duration);
  late final List<_Piece> _pieces = _make();

  List<_Piece> _make() {
    final random = math.Random(widget.seed);
    return [
      for (var i = 0; i < widget.count; i++)
        _Piece(
          angle: -math.pi / 2 + (random.nextDouble() - 0.5) * math.pi * 1.25,
          speed: 0.55 + random.nextDouble() * 0.75,
          spin: (random.nextDouble() - 0.5) * 14,
          size: 5 + random.nextDouble() * 6,
          round: random.nextBool(),
          color: widget.colors[i % widget.colors.length],
          drift: (random.nextDouble() - 0.5) * 0.3,
        ),
    ];
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && !context.reduceMotion) _controller.forward();
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (context.reduceMotion) return const SizedBox.shrink();
    return IgnorePointer(
      child: ExcludeSemantics(
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, _) => _controller.value == 0 || _controller.isCompleted
              ? const SizedBox.expand()
              : CustomPaint(size: Size.infinite, painter: _ConfettiPainter(_pieces, _controller.value, widget.origin)),
        ),
      ),
    );
  }
}

class _Piece {
  const _Piece({
    required this.angle,
    required this.speed,
    required this.spin,
    required this.size,
    required this.round,
    required this.color,
    required this.drift,
  });

  final double angle;
  final double speed;
  final double spin;
  final double size;
  final bool round;
  final Color color;
  final double drift;
}

class _ConfettiPainter extends CustomPainter {
  _ConfettiPainter(this.pieces, this.t, this.origin);

  final List<_Piece> pieces;
  final double t;
  final Alignment origin;

  @override
  void paint(Canvas canvas, Size size) {
    final start = origin.alongSize(size);
    final scale = size.shortestSide;
    // Thrown out fast, slowed by the air, then falling; faded out over the last third.
    final fly = 1 - math.pow(1 - t, 3).toDouble();
    final fade = t < 0.66 ? 1.0 : (1 - (t - 0.66) / 0.34).clamp(0.0, 1.0);
    final paint = Paint();
    for (final p in pieces) {
      final dx = math.cos(p.angle) * p.speed * scale * 0.55 * fly + p.drift * scale * t;
      final dy = math.sin(p.angle) * p.speed * scale * 0.55 * fly + 0.9 * scale * t * t;
      paint.color = p.color.withValues(alpha: p.color.a * fade);
      canvas.save();
      canvas.translate(start.dx + dx, start.dy + dy);
      canvas.rotate(p.spin * t);
      if (p.round) {
        canvas.drawCircle(Offset.zero, p.size / 2, paint);
      } else {
        canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromCenter(center: Offset.zero, width: p.size, height: p.size * 0.5), const Radius.circular(1.5)), paint);
      }
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(_ConfettiPainter old) => old.t != t;
}

/// A number counting up to [value] when it appears (XP earned), built by [builder]; shown at once with reduced motion.
class CountUp extends StatelessWidget {
  const CountUp({super.key, required this.value, required this.builder, this.duration = const Duration(milliseconds: 900)});

  final int value;
  final Widget Function(BuildContext context, int value) builder;
  final Duration duration;

  @override
  Widget build(BuildContext context) {
    if (context.reduceMotion || value <= 0) return builder(context, value);
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: value.toDouble()),
      duration: duration,
      curve: Curves.easeOutCubic,
      builder: (context, v, _) => builder(context, v.round()),
    );
  }
}
