import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:langquest_mobile/core/layout/celebration.dart';

Widget host(Widget child, {bool reduceMotion = false}) => MaterialApp(
  home: MediaQuery(
    data: MediaQueryData(size: const Size(390, 844), disableAnimations: reduceMotion),
    child: Scaffold(body: child),
  ),
);

void main() {
  testWidgets('confetti bursts once and is gone; nothing at all with reduced motion', (t) async {
    await t.pumpWidget(host(const ConfettiBurst(colors: [Colors.red, Colors.blue])));
    await t.pump();
    await t.pump(const Duration(milliseconds: 500));
    expect(find.byType(CustomPaint), findsWidgets, reason: 'drawn while it flies');
    await t.pumpAndSettle();
    expect(t.takeException(), isNull);

    await t.pumpWidget(host(const ConfettiBurst(colors: [Colors.red]), reduceMotion: true));
    await t.pump(const Duration(milliseconds: 500));
    expect(find.descendant(of: find.byType(ConfettiBurst), matching: find.byType(CustomPaint)), findsNothing);
  });

  testWidgets('a count-up ends on its value; with reduced motion it starts there', (t) async {
    Widget count({bool reduce = false}) => host(CountUp(value: 50, builder: (context, v) => Text('+$v XP')), reduceMotion: reduce);
    await t.pumpWidget(count());
    expect(find.text('+50 XP'), findsNothing);
    await t.pumpAndSettle();
    expect(find.text('+50 XP'), findsOneWidget);

    await t.pumpWidget(const SizedBox());
    await t.pumpWidget(count(reduce: true));
    expect(find.text('+50 XP'), findsOneWidget);
  });
}
