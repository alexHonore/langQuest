import '../audio/clip_player.dart';

bool get canPlayClips => false;

ClipPlayer createClipPlayer() => throw UnsupportedError('No clip player outside the browser in this build');
