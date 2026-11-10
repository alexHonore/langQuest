/// Recording the learner's voice: in the browser (MediaRecorder); not offered elsewhere yet (no recorder plugin in this
/// build), so callers check [canRecordTakes] and hide the action (visible means usable).
library;

export 'recorder_stub.dart' if (dart.library.js_interop) 'recorder_web.dart';
