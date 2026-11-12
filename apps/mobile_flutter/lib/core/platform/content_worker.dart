/// The web app's offline service worker (`web/sw.js`), told which course the learner left so it drops that course's
/// kept content; nothing to do elsewhere.
library;

export 'content_worker_stub.dart' if (dart.library.js_interop) 'content_worker_web.dart';
