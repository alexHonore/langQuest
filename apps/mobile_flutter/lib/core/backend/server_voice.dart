import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../audio/clip_player.dart';
import '../audio/clip_player_provider.dart';
import '../services/app_state.dart';
import '../services/speech_service.dart';
import 'account.dart';
import 'api_client.dart';
import 'curriculum_ids.dart';
import 'server_course.dart';

/// The server's synthetic voice for a course's approved lines (`POST /v1/speech/synthesize` by expression id): used
/// where the device has no voice for the course's exact variety (Darija, or a browser without that locale). Each clip
/// is fetched once per session and kept in memory; nothing is stored on the device.
class ServerVoice {
  ServerVoice({required this.api, required this.course, required this.player});

  final LangQuestApi api;
  final ServerCourse course;
  final ClipPlayer player;
  final _clips = <String, Future<String?>>{};

  /// The clip of [expressionId] (a bundle id), as a playable URL; null when the server has none for it.
  Future<String?> clip(String expressionId, {bool slow = false}) {
    final key = '$expressionId|${slow ? 'slow' : 'normal'}';
    return _clips.putIfAbsent(
      key,
      () => _fetch(expressionId, slow).then((url) {
        if (url == null) _clips.remove(key); // a failure is asked again next time
        return url;
      }),
    );
  }

  Future<String?> _fetch(String expressionId, bool slow) async {
    try {
      final data = await api.synthesize(
        enrollmentId: course.enrollmentId,
        targetVarietyId: course.targetVarietyId,
        expressionId: expressionServerId(expressionId),
        slow: slow,
      );
      final audio = data['audio'] is Map ? data['audio'] as Map : const {};
      final url = audio['url'];
      if (url is String && url.isNotEmpty) return url;
      final base64 = audio['base64'];
      if (base64 is! String || base64.isEmpty) return null;
      final mime = switch (audio['encoding']) {
        'mp3' => 'audio/mpeg',
        'wav' || 'pcm16' => 'audio/wav',
        'opus' => 'audio/ogg',
        'aac' || 'm4a' => 'audio/mp4',
        _ => 'audio/mpeg',
      };
      return 'data:$mime;base64,$base64';
    } on ApiException {
      return null;
    }
  }

  /// Says [expressionId]; completes when the clip ends (or at once when there is none).
  Future<void> speak(String expressionId, {bool slow = false}) async {
    player.stop();
    final url = await clip(expressionId, slow: slow);
    if (url != null) await player.play(url);
  }

  void stop() => player.stop();
}

/// The active course's server voice: signed in, the server answers, it voices this course (`GET /v1/courses`
/// `speechSynthesis`), and clips can be played here. Null otherwise.
final serverVoiceProvider = Provider<ServerVoice?>((ref) {
  final api = ref.watch(apiProvider);
  final makePlayer = ref.watch(clipPlayerFactoryProvider);
  final active = ref.watch(appStateProvider.select((s) => s.activeCourse));
  if (api == null || makePlayer == null || active == null) return null;
  final course = ref.watch(accountProvider).serverCourse(active.id);
  final offer = ref.watch(serverOffersProvider(active.source)).asData?.value[active.track.id];
  if (course == null || offer == null || !offer.aiVoice) return null;
  final player = makePlayer();
  final voice = ServerVoice(api: api, course: course, player: player);
  // Whatever stops the device voice (a new line, a recording starting) stops this one too.
  final speech = ref.read(speechServiceProvider);
  speech.addStopListener(player.stop);
  ref.onDispose(() {
    speech.removeStopListener(player.stop);
    player.dispose();
  });
  return voice;
});

/// How a line is voiced on this device for the active course: the device's own voice for the exact variety, else
/// the server's AI voice, else none (listen controls are then not shown).
enum LineVoiceSource { device, server, none }

@immutable
class LineVoice {
  const LineVoice({required this.source, this.locale, this.server, required this.speech});

  final LineVoiceSource source;
  final String? locale;
  final ServerVoice? server;
  final SpeechService speech;

  bool get available => source != LineVoiceSource.none;

  /// Fetches the server's clip of a line ahead of time (nothing to do for the device voice).
  void prepare(String? expressionId, {bool slow = false}) {
    if (source == LineVoiceSource.server && expressionId != null) unawaited(server!.clip(expressionId, slow: slow));
  }

  /// Says a line: [text] with the device voice, or the approved line [expressionId] with the server's voice.
  Future<void> say({required String text, String? expressionId, bool slow = false}) async {
    switch (source) {
      case LineVoiceSource.device:
        await speech.speak(text, locale: locale!, slow: slow);
      case LineVoiceSource.server:
        if (expressionId != null) await server!.speak(expressionId, slow: slow);
      case LineVoiceSource.none:
        return;
    }
  }
}

/// The voice for lines of the course whose device locale is [locale] (the course's `voiceLocale`, null for a
/// dialect with no device voice). Auto-disposed: a screen opened later asks the device again.
final lineVoiceProvider = FutureProvider.autoDispose.family<LineVoice, String?>((ref, locale) async {
  final speech = ref.watch(speechServiceProvider);
  final server = ref.watch(serverVoiceProvider);
  final device = locale != null && await ref.watch(voiceAvailableProvider(locale).future);
  if (device) return LineVoice(source: LineVoiceSource.device, locale: locale, speech: speech);
  if (server != null) return LineVoice(source: LineVoiceSource.server, server: server, speech: speech);
  return LineVoice(source: LineVoiceSource.none, speech: speech);
});
