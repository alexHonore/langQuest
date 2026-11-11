import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../platform/clip_player.dart';
import 'clip_player.dart';

/// Makes a player of the server's audio clips; null where clips cannot be played (the browser build plays them).
final clipPlayerFactoryProvider = Provider<ClipPlayer Function()?>((ref) => canPlayClips ? createClipPlayer : null);
