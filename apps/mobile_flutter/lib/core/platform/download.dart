/// Saving a text file for the learner: a real download in the browser; not offered elsewhere yet (no file or share
/// plugin in this build), so callers check [canDownloadFiles] and hide the action (visible means usable).
library;

export 'download_stub.dart' if (dart.library.js_interop) 'download_web.dart';
