import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

/// The learner app is designed for phones. When the web build is opened in a wide window (a computer or a
/// tablet browser) it is shown at phone size, centered, instead of being stretched across the screen; on a
/// phone it fills the screen as usual. Everything below reads the frame's size from [MediaQuery], so screens
/// lay out exactly as they do on a phone.
class PhoneFrame extends StatelessWidget {
  const PhoneFrame({super.key, required this.child, required this.backdrop, required this.outline, this.enabled = kIsWeb});

  final Widget child;

  /// Painted around the frame.
  final Color backdrop;

  /// The frame's edge.
  final Color outline;

  /// Only the web build is framed: native tablets keep their own layout.
  final bool enabled;

  /// A large phone in logical pixels.
  static const Size phoneSize = Size(430, 932);

  /// A window at least this wide and tall is not a phone (a phone in landscape stays unframed).
  static const Size minFramedWindow = Size(600, 560);

  static const double margin = 16;
  static const double radius = 32;

  static bool isFramed(Size window) => window.width >= minFramedWindow.width && window.height >= minFramedWindow.height;

  static Size frameSizeFor(Size window) => Size(phoneSize.width, math.min(phoneSize.height, window.height - 2 * margin));

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    if (!enabled || !isFramed(media.size)) return child;
    final size = frameSizeFor(media.size);
    final shape = BorderRadius.circular(radius);
    return ColoredBox(
      color: backdrop,
      child: Center(
        child: SizedBox.fromSize(
          size: size,
          child: DecoratedBox(
            decoration: BoxDecoration(
              borderRadius: shape,
              boxShadow: const [BoxShadow(color: Color(0x59000000), blurRadius: 48, offset: Offset(0, 20))],
            ),
            child: DecoratedBox(
              position: DecorationPosition.foreground,
              decoration: BoxDecoration(borderRadius: shape, border: Border.all(color: outline)),
              child: ClipRRect(
                borderRadius: shape,
                child: MediaQuery(
                  data: media.copyWith(size: size, padding: EdgeInsets.zero, viewPadding: EdgeInsets.zero, viewInsets: EdgeInsets.zero),
                  child: child,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Lets a mouse drag lists and card pages like a finger, so the phone-sized web app can be tried on a computer.
class PhoneScrollBehavior extends MaterialScrollBehavior {
  const PhoneScrollBehavior();

  @override
  Set<PointerDeviceKind> get dragDevices => {...super.dragDevices, PointerDeviceKind.mouse};
}
