import 'dart:js_interop';

import 'package:web/web.dart' as web;

/// Asks the service worker to drop [trackId]'s kept content (the learner left the course).
void forgetCourseInServiceWorker(String trackId) {
  try {
    web.window.navigator.serviceWorker.controller?.postMessage({'type': 'forget-course', 'track': trackId}.jsify());
  } catch (_) {}
}
