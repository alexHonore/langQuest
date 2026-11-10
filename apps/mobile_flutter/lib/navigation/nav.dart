import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';

extension PopOrHome on BuildContext {
  /// Back/close: pop when there is a screen underneath, else go Home (a screen opened from a deep link or after a
  /// replace has nothing below it, and popping it would leave the app on nothing).
  void popOrHome() => canPop() ? pop() : go('/');
}
