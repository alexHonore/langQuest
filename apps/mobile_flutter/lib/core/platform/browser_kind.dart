/// What kind of browser the web app runs in, for device-specific help (allowing the microphone).
library;

export 'browser_kind_stub.dart' if (dart.library.js_interop) 'browser_kind_web.dart';

/// Where the steps to allow the microphone differ.
enum BrowserKind { iosSafari, android, desktop, other }
