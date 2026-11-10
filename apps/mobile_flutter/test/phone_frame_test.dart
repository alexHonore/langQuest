import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:langquest_mobile/core/layout/phone_frame.dart';

void main() {
  /// Pumps an app framed like the web build in a window of [window] logical pixels; returns what a screen sees.
  Future<MediaQueryData> screenMediaIn(WidgetTester tester, Size window, {bool enabled = true}) async {
    tester.view.physicalSize = window;
    tester.view.devicePixelRatio = 1;
    tester.view.padding = const FakeViewPadding(top: 24, bottom: 34);
    addTearDown(tester.view.reset);
    late MediaQueryData seen;
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => PhoneFrame(enabled: enabled, backdrop: Colors.black, outline: Colors.white24, child: child!),
        home: Builder(
          builder: (context) {
            seen = MediaQuery.of(context);
            return const Scaffold(body: Text('screen'));
          },
        ),
      ),
    );
    return seen;
  }

  testWidgets('a computer window shows the app at phone size, centered, without the window insets', (tester) async {
    final media = await screenMediaIn(tester, const Size(1280, 800));
    expect(media.size, const Size(430, 800 - 2 * PhoneFrame.margin));
    expect(media.padding, EdgeInsets.zero);
    final box = tester.getRect(find.byType(Scaffold));
    expect(box.size, media.size);
    expect(box.center, const Offset(640, 400));
  });

  testWidgets('a tall window keeps the phone height', (tester) async {
    final media = await screenMediaIn(tester, const Size(1600, 1400));
    expect(media.size, PhoneFrame.phoneSize);
  });

  testWidgets('a phone fills its screen, in portrait and in landscape', (tester) async {
    for (final window in const [Size(390, 844), Size(844, 390)]) {
      final media = await screenMediaIn(tester, window);
      expect(media.size, window);
      expect(media.padding.top, 24);
      expect(tester.getRect(find.byType(Scaffold)), Offset.zero & window);
    }
  });

  testWidgets('outside the web build nothing is framed', (tester) async {
    final media = await screenMediaIn(tester, const Size(1280, 800), enabled: false);
    expect(media.size, const Size(1280, 800));
  });

  test('a mouse can drag lists and card pages in the web build', () {
    expect(const PhoneScrollBehavior().dragDevices, containsAll([PointerDeviceKind.mouse, PointerDeviceKind.touch]));
  });
}
