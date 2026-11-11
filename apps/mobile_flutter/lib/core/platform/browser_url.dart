/// The browser's address bar: replaced without a reload (web); nothing to do elsewhere.
library;

export 'browser_url_stub.dart' if (dart.library.js_interop) 'browser_url_web.dart';
