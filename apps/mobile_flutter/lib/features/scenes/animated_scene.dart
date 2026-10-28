import 'package:flutter/material.dart';
import 'scene_models.dart';
import 'scene_painter.dart';

class AnimatedSceneWidget extends StatefulWidget {
  final SceneId sceneId;
  final SceneVariant initialVariant;
  final double height;
  final double? width;
  final Widget? child;
  final bool showTimeToggle;

  const AnimatedSceneWidget({
    super.key,
    required this.sceneId,
    this.initialVariant = SceneVariant.evening,
    this.height = 200,
    this.width,
    this.child,
    this.showTimeToggle = true,
  });

  @override
  State<AnimatedSceneWidget> createState() => _AnimatedSceneWidgetState();
}

class _AnimatedSceneWidgetState extends State<AnimatedSceneWidget>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ambientController;
  late SceneVariant _variant;
  Offset _touchParallax = Offset.zero;

  @override
  void initState() {
    super.initState();
    _variant = widget.initialVariant;
    _ambientController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 4000),
    )..repeat();
  }

  @override
  void dispose() {
    _ambientController.dispose();
    super.dispose();
  }

  void _handlePanUpdate(DragUpdateDetails details) {
    setState(() {
      _touchParallax = Offset(
        (_touchParallax.dx + details.delta.dx * 0.003).clamp(-1.0, 1.0),
        (_touchParallax.dy + details.delta.dy * 0.003).clamp(-1.0, 1.0),
      );
    });
  }

  void _handlePanEnd(DragEndDetails details) {
    setState(() {
      _touchParallax = Offset.zero;
    });
  }

  @override
  Widget build(BuildContext context) {
    final sceneDef = SceneDefinition.get(widget.sceneId);

    return ClipRRect(
      borderRadius: BorderRadius.circular(20),
      child: GestureDetector(
        onPanUpdate: _handlePanUpdate,
        onPanEnd: _handlePanEnd,
        child: SizedBox(
          height: widget.height,
          width: widget.width ?? double.infinity,
          child: Stack(
            fit: StackFit.expand,
            children: [
              // 1. Vector Painted Animated Canvas
              AnimatedBuilder(
                animation: _ambientController,
                builder: (context, _) {
                  return CustomPaint(
                    painter: ScenePainter(
                      sceneId: widget.sceneId,
                      variant: _variant,
                      animationProgress: _ambientController.value,
                      parallaxOffset: _touchParallax,
                    ),
                  );
                },
              ),

              // 2. Scene Title Badge
              Positioned(
                top: 12,
                left: 14,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: const Color(0xB30B0913),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0x33FFFFFF)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        _variant == SceneVariant.evening
                            ? Icons.nights_stay_rounded
                            : Icons.wb_sunny_rounded,
                        size: 13,
                        color: _variant == SceneVariant.evening
                            ? const Color(0xFFFFB547)
                            : const Color(0xFFFFD15C),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        sceneDef.title,
                        style: const TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w600,
                          color: Colors.white,
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              // 3. Time-of-day Day/Night Toggle
              if (widget.showTimeToggle)
                Positioned(
                  top: 12,
                  right: 14,
                  child: GestureDetector(
                    onTap: () {
                      setState(() {
                        _variant = _variant == SceneVariant.evening
                            ? SceneVariant.day
                            : SceneVariant.evening;
                      });
                    },
                    child: Container(
                      padding: const EdgeInsets.all(6),
                      decoration: BoxDecoration(
                        color: const Color(0xB30B0913),
                        shape: BoxShape.circle,
                        border: Border.all(color: const Color(0x33FFFFFF)),
                      ),
                      child: Icon(
                        _variant == SceneVariant.evening
                            ? Icons.wb_sunny_outlined
                            : Icons.nights_stay_outlined,
                        size: 14,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ),

              // 4. Foreground Content (Characters, Dialogue, etc.)
              if (widget.child != null) widget.child!,
            ],
          ),
        ),
      ),
    );
  }
}
