import 'package:web/web.dart' as web;

import 'browser_kind.dart';

/// From the user agent; iPadOS reports a Mac, told apart by its touch screen.
BrowserKind currentBrowserKind() {
  try {
    final ua = web.window.navigator.userAgent.toLowerCase();
    final touch = web.window.navigator.maxTouchPoints > 1;
    if (ua.contains('iphone') || ua.contains('ipad') || ua.contains('ipod') || (ua.contains('macintosh') && touch)) return BrowserKind.iosSafari;
    if (ua.contains('android')) return BrowserKind.android;
    return BrowserKind.desktop;
  } catch (_) {
    return BrowserKind.other;
  }
}
