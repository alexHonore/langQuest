/// Playing the character's voice in a live conversation: in the browser (an audio element); elsewhere the lines are
/// shown as text only (no audio plugin in this build), so callers check [canPlayClips].
library;

export 'clip_player_stub.dart' if (dart.library.js_interop) 'clip_player_web.dart';
