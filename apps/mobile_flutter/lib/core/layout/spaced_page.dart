import 'dart:math' as math;

import 'package:flutter/widgets.dart';

/// A page laid out on the screen's height — [top] centred in the room above [bottom], which sits at the foot — that
/// scrolls instead when its content needs more room than the screen (large text). No intrinsic-size pass: a Column
/// in an IntrinsicHeight overflowed the welcome screen at 200 % text, some widgets reporting less than they take.
class SpacedPage extends StatelessWidget {
  const SpacedPage({super.key, required this.top, required this.bottom, this.padding = const EdgeInsets.fromLTRB(24, 16, 24, 16)});

  final List<Widget> top;
  final List<Widget> bottom;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, box) => SingleChildScrollView(
      padding: padding,
      child: ConstrainedBox(
        constraints: BoxConstraints(minHeight: math.max(0, box.maxHeight - padding.vertical)),
        // Taller than its children when the screen allows: the free height goes above and below [top].
        child: Column(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox.shrink(),
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: top),
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [const SizedBox(height: 20), ...bottom]),
          ],
        ),
      ),
    ),
  );
}
