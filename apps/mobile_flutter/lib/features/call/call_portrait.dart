import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../core/backend/curriculum_ids.dart';
import '../../core/layout/motion.dart';
import '../scenes/scene_models.dart';

/// `characters.id` of an art roster id: UUIDv5 of `langquest.character:<roster id>` in the roster's namespace
/// (`packages/db/src/character-uuid.ts`, shared by the art, the seed and every client).
const characterNamespace = 'd0a6e7c4-9d2b-4f3a-8e1c-5b7f2c9a1e34';

String characterServerId(String rosterId) => uuidV5(characterNamespace, 'langquest.character:$rosterId');

/// The roster characters whose portraits ship with this build (`assets/characters/<roster id>.<expression>.svg`):
/// the cast of the bundled courses' varieties (es-ES, ja, en, ary).
const portraitRoster = [
  'ary-cafe-staff-nadia',
  'ary-neighbour-youssef',
  'ary-schoolgirl-salma',
  'ary-student-omar',
  'en-bus-driver-marcus',
  'en-retired-postwoman-margaret',
  'en-schoolgirl-maya',
  'en-student-dev',
  'es-es-coworker-marta',
  'es-es-retired-bus-driver-antonio',
  'es-es-schoolboy-pablo',
  'ja-neighbour-haruka',
  'ja-retired-stationmaster-kenji',
  'ja-schoolboy-sota',
];

/// The art's expressions: the conversation contract's eight, plus `lip_sync` (the mouth mid-word).
const portraitExpressions = {'neutral', 'greeting', 'listening', 'talking', 'lip_sync', 'surprise', 'confusion', 'friendly_success', 'follow_up_question'};

final Map<String, String> _rosterByServerId = {for (final r in portraitRoster) characterServerId(r): r};

/// The roster id of a server character, when its portrait ships with this build.
String? rosterIdFor(String characterId) => _rosterByServerId[characterId];

/// Where a roster character works or lives, read from the role in their roster id (`ary-cafe-staff-nadia` → the café,
/// `es-es-coworker-marta` → the office): the backdrop of a free call with them. Null for a role without one place
/// (a student, a schoolboy): the call then happens where the learner's next mission does.
SceneId? sceneForRoster(String rosterId) {
  final id = '-$rosterId-';
  if (id.contains('-cafe-')) return SceneId.cafe;
  if (id.contains('-neighbour-')) return SceneId.home;
  if (id.contains('-coworker-')) return SceneId.office;
  if (id.contains('-bus-driver-')) return SceneId.transit;
  if (id.contains('-stationmaster-')) return SceneId.station;
  if (id.contains('-postwoman-') || id.contains('-postman-')) return SceneId.street;
  return null;
}

String portraitAsset(String rosterId, String expression) =>
    'assets/characters/$rosterId.${portraitExpressions.contains(expression) ? expression : 'neutral'}.svg';

/// The caller, alive: the expression of the moment, the mouth following the voice while they speak (`talking` ↔
/// `lip_sync`, from the audio's level), a slow breath, rings that swell with the voice, and a small pop when the
/// expression changes. With reduced motion it is a still portrait of the current expression. Decorative: the screen
/// says who is speaking and what they said.
class CallPortrait extends StatefulWidget {
  const CallPortrait({
    super.key,
    required this.rosterId,
    required this.name,
    required this.expression,
    required this.speaking,
    required this.level,
    required this.ringColor,
    this.size = 200,
  });

  /// Null when the character has no portrait in this build: their initial is shown.
  final String? rosterId;
  final String name;

  /// The expression held when not speaking (`neutral`, `listening`, `friendly_success`…).
  final String expression;
  final bool speaking;

  /// The voice's level, 0–1, while speaking.
  final ValueListenable<double> level;
  final Color ringColor;
  final double size;

  @override
  State<CallPortrait> createState() => _CallPortraitState();
}

class _CallPortraitState extends State<CallPortrait> with SingleTickerProviderStateMixin {
  late final AnimationController _breath = AnimationController(vsync: this, duration: const Duration(milliseconds: 3200));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (context.reduceMotion) {
      _breath.stop();
    } else if (!_breath.isAnimating) {
      _breath.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _breath.dispose();
    super.dispose();
  }

  Widget _frame(String expression) {
    final roster = widget.rosterId;
    if (roster == null) {
      final initial = widget.name.isEmpty ? '?' : String.fromCharCode(widget.name.runes.first).toUpperCase();
      return Container(
        decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0xFFF7EFE6)),
        alignment: Alignment.center,
        child: Text(
          initial,
          style: TextStyle(fontSize: widget.size * 0.4, fontWeight: FontWeight.w800, color: const Color(0xFF3A2A22)),
        ),
      );
    }
    return SvgPicture.asset(portraitAsset(roster, expression), width: widget.size, height: widget.size, excludeFromSemantics: true);
  }

  @override
  Widget build(BuildContext context) {
    final still = context.reduceMotion;
    final size = widget.size;
    return ExcludeSemantics(
      child: SizedBox.square(
        dimension: size * 1.3,
        child: ValueListenableBuilder<double>(
          valueListenable: widget.level,
          builder: (context, level, _) {
            final speaking = widget.speaking;
            final open = speaking && !still && level > 0.16;
            final voice = speaking ? level : 0.0;
            return AnimatedBuilder(
              animation: _breath,
              builder: (context, child) {
                final breath = still ? 0.0 : Curves.easeInOut.transform(_breath.value);
                return Stack(
                  alignment: Alignment.center,
                  children: [
                    if (!still)
                      CustomPaint(
                        size: Size.square(size * 1.3),
                        painter: _VoiceRings(color: widget.ringColor, level: voice, phase: _breath.value),
                      ),
                    Transform.translate(
                      offset: Offset(0, -2 * breath - (open ? 2.5 * voice : 0)),
                      child: Transform.scale(scale: 1 + 0.012 * breath, child: child),
                    ),
                  ],
                );
              },
              // Every frame stays loaded, so the mouth never flickers while the picture decodes.
              child: SizedBox.square(
                dimension: size,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    Opacity(opacity: speaking && !open ? 1 : 0, child: _frame('talking')),
                    Opacity(opacity: open ? 1 : 0, child: _frame('lip_sync')),
                    Opacity(
                      opacity: speaking ? 0 : 1,
                      child: AnimatedSwitcher(
                        duration: still ? Duration.zero : const Duration(milliseconds: 260),
                        transitionBuilder: (child, animation) => ScaleTransition(
                          scale: Tween(begin: 0.94, end: 1.0).animate(CurvedAnimation(parent: animation, curve: Curves.easeOutBack)),
                          child: child,
                        ),
                        child: KeyedSubtree(key: ValueKey(widget.expression), child: _frame(widget.expression)),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

/// Soft rings around the portrait that swell with the voice.
class _VoiceRings extends CustomPainter {
  _VoiceRings({required this.color, required this.level, required this.phase});

  final Color color;
  final double level;
  final double phase;

  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    final base = size.shortestSide / 2 / 1.3;
    for (var i = 0; i < 3; i++) {
      final swell = level * (10 + 8 * i) + 3 * math.sin((phase + i / 3) * math.pi * 2).abs();
      final paint = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3 - i * 0.6
        ..color = color.withValues(alpha: (0.10 + 0.45 * level) * (1 - i / 3.2));
      canvas.drawCircle(center, base + 6 + i * 9 + swell, paint);
    }
  }

  @override
  bool shouldRepaint(_VoiceRings old) => old.level != level || old.phase != phase || old.color != color;
}
