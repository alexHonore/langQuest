import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../core/theme/colors.dart';
import '../../core/theme/glass.dart';
import 'melo_model.dart';
import 'melo_painter.dart';

class MeloWidget extends StatefulWidget {
  final MeloState state;
  final String? courseTrackId;
  final String? speech;
  final double size;
  final VoidCallback? onTap;

  const MeloWidget({
    super.key,
    this.state = MeloState.companion,
    this.courseTrackId,
    this.speech,
    this.size = 96.0,
    this.onTap,
  });

  @override
  State<MeloWidget> createState() => _MeloWidgetState();
}

class _MeloWidgetState extends State<MeloWidget> with TickerProviderStateMixin {
  late final AnimationController _breathController;
  late final AnimationController _blinkController;
  late final AnimationController _tailController;
  late final AnimationController _jumpController;

  Timer? _blinkTimer;
  Timer? _eyeWanderTimer;

  Offset _leftGaze = Offset.zero;
  Offset _rightGaze = Offset.zero;
  final math.Random _random = math.Random();

  @override
  void initState() {
    super.initState();

    // 1. Smooth rhythmic breathing (2.8s period)
    _breathController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2800),
    )..repeat(reverse: true);

    // 2. Quick eyelid blink (180ms)
    _blinkController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 180),
    );

    // 3. Gentle tail sway (2.2s period)
    _tailController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2200),
    )..repeat(reverse: true);

    // 4. Tap reaction jump
    _jumpController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 400),
    );

    _scheduleNextBlink();
    _startEyeWander();
  }

  void _scheduleNextBlink() {
    final nextMs = 2500 + _random.nextInt(3500);
    _blinkTimer = Timer(Duration(milliseconds: nextMs), () {
      if (!mounted) return;
      _blinkController.forward().then((_) {
        if (mounted) _blinkController.reverse();
      });
      _scheduleNextBlink();
    });
  }

  void _startEyeWander() {
    // Chameleons can move their eyes independently!
    _eyeWanderTimer = Timer.periodic(const Duration(milliseconds: 1600), (_) {
      if (!mounted) return;
      setState(() {
        _leftGaze = Offset(
          (_random.nextDouble() * 2.0 - 1.0) * 0.75,
          (_random.nextDouble() * 2.0 - 1.0) * 0.6,
        );
        _rightGaze = Offset(
          (_random.nextDouble() * 2.0 - 1.0) * 0.75,
          (_random.nextDouble() * 2.0 - 1.0) * 0.6,
        );
      });
    });
  }

  @override
  void dispose() {
    _blinkTimer?.cancel();
    _eyeWanderTimer?.cancel();
    _breathController.dispose();
    _blinkController.dispose();
    _tailController.dispose();
    _jumpController.dispose();
    super.dispose();
  }

  void _handleTap() {
    HapticFeedback.lightImpact();
    _jumpController.forward().then((_) {
      if (mounted) _jumpController.reverse();
    });
    widget.onTap?.call();
  }

  @override
  Widget build(BuildContext context) {
    final tint = MeloTint.forCourseAndState(widget.courseTrackId, widget.state);

    return AnimatedBuilder(
      animation: Listenable.merge([
        _breathController,
        _blinkController,
        _tailController,
        _jumpController,
      ]),
      builder: (context, child) {
        final double jumpY = -math.sin(_jumpController.value * math.pi) * 14.0;
        final double tongueFlick = math.sin(_jumpController.value * math.pi);

        Widget melo = Transform.translate(
          offset: Offset(0, jumpY),
          child: GestureDetector(
            onTap: _handleTap,
            child: CustomPaint(
              size: Size(widget.size, widget.size),
              painter: MeloPainter(
                state: widget.state,
                tint: tint,
                breath: _breathController.value,
                blink: _blinkController.value,
                tailWag: (_tailController.value * 2.0 - 1.0),
                leftGaze: _leftGaze,
                rightGaze: _rightGaze,
                tongueFlick: tongueFlick,
              ),
            ),
          ),
        );

        if (widget.speech == null || widget.speech!.isEmpty) {
          return melo;
        }

        // With Speech Bubble
        return Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            melo,
            const SizedBox(width: 12),
            Expanded(
              child: GlassContainer(
                level: GlassLevel.level2,
                radius: 18,
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                customGlow: tint.crest.withOpacity(0.35),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        widget.speech!,
                        style: TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w500,
                          color: LangQuestColors.dark.textPrimary,
                          height: 1.35,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}
