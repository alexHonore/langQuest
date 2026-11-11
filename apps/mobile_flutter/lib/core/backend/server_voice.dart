import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../audio/clip_player.dart';
import '../audio/wav.dart';
import '../audio/clip_player_provider.dart';
import '../content/bundled_voices.dart';
import '../content/content_bundle.dart';
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
      // Raw PCM (some varieties' voice, e.g. Darija) gets the WAV header a browser needs.
      return audioDataUrl(
        base64,
        encoding: '${audio['encoding'] ?? 'mp3'}',
        sampleRateHz: (audio['sampleRateHz'] as num?)?.toInt(),
        durationMs: (audio['durationMs'] as num?)?.toInt(),
      );
    } on ApiException {
      return null;
    }
  }

  /// Says [expressionId]; completes when the clip ends (or at once when there is none). False when the server had
  /// no clip for it. Slowly is the same clip played slower (a model asked to "speak slowly" barely does).
  Future<bool> speak(String expressionId, {bool slow = false}) async {
    player.stop();
    final url = await clip(expressionId);
    if (url == null) return false;
    await player.play(url, rate: slow ? slowPlaybackRate : 1);
    return true;
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

/// "Slowly": the clip played at this rate, at the same pitch.
const double slowPlaybackRate = 0.72;

/// The course lines pre-recorded by natural AI voices and bundled with the app (`BundledVoices`): played for every
/// learner, signed in or not, offline too. Null where clips cannot be played.
class BundledVoice {
  BundledVoice({required this.voices, required this.player});

  final BundledVoices voices;
  final ClipPlayer player;

  bool has(String? expressionId) => voices.clipOf(expressionId) != null;

  /// Says [expressionId]; false when no clip is bundled for it.
  Future<bool> speak(String expressionId, {bool slow = false}) async {
    final asset = voices.clipOf(expressionId);
    if (asset == null) return false;
    player.stop();
    // Flutter web serves the app's assets under `assets/`.
    await player.play('assets/$asset', rate: slow ? slowPlaybackRate : 1);
    return true;
  }

  void stop() => player.stop();
}

final bundledVoiceProvider = Provider<BundledVoice?>((ref) {
  final makePlayer = ref.watch(clipPlayerFactoryProvider);
  final voices = ref.watch(contentBundleProvider).voices;
  if (makePlayer == null || voices.isEmpty) return null;
  final player = makePlayer();
  final voice = BundledVoice(voices: voices, player: player);
  // Whatever stops the device voice (a new line, a recording starting) stops this one too.
  final speech = ref.read(speechServiceProvider);
  speech.addStopListener(player.stop);
  ref.onDispose(() {
    speech.removeStopListener(player.stop);
    player.dispose();
  });
  return voice;
});

/// How a line is voiced on this device for the active course: its bundled AI clip first (any learner); else the
/// server's AI voice (signed in, on a course it voices); else the device's own voice for the exact variety; else
/// none (listen controls are then not shown).
enum LineVoiceSource { device, server, bundled, none }

@immutable
class LineVoice {
  const LineVoice({required this.source, this.locale, this.server, this.bundled, required this.speech});

  /// The voice for lines without a bundled clip (`bundled` when only bundled clips can be played).
  final LineVoiceSource source;

  /// The course's bundled AI clips, played first.
  final BundledVoice? bundled;

  /// The device's voice locale for the exact variety, when it has one (with the server's voice: its fallback).
  final String? locale;
  final ServerVoice? server;
  final SpeechService speech;

  bool get available => source != LineVoiceSource.none;

  /// Whether the course's lines are read by an AI voice here (bundled clips, or the server's voice).
  bool get ai => bundled != null || source == LineVoiceSource.server;

  /// Whether [expressionId] is read by an AI voice (its bundled clip, or the server's voice).
  bool aiFor(String? expressionId) => (bundled?.has(expressionId) ?? false) || (source == LineVoiceSource.server && expressionId != null);

  /// Fetches the server's clip of a line ahead of time (nothing to do for the device voice).
  void prepare(String? expressionId, {bool slow = false}) {
    if (bundled?.has(expressionId) ?? false) return;
    if (source == LineVoiceSource.server && expressionId != null) unawaited(server!.clip(expressionId));
  }

  /// Whether [expressionId] (or, without one, [text]) can be said: the server says approved lines only.
  bool canSay({String? expressionId}) =>
      (bundled?.has(expressionId) ?? false) ||
      switch (source) {
        LineVoiceSource.device => true,
        LineVoiceSource.server => expressionId != null || locale != null,
        LineVoiceSource.bundled || LineVoiceSource.none => false,
      };

  /// Says a line: the approved line [expressionId] with the server's AI voice, else [text] with the device voice
  /// (also when the server has no clip for it).
  Future<void> say({required String text, String? expressionId, bool slow = false}) async {
    if (expressionId != null && bundled != null && await bundled!.speak(expressionId, slow: slow)) return;
    switch (source) {
      case LineVoiceSource.device:
        await speech.speak(text, locale: locale!, slow: slow);
      case LineVoiceSource.server:
        final said = expressionId != null && await server!.speak(expressionId, slow: slow);
        if (!said && locale != null) await speech.speak(text, locale: locale!, slow: slow);
      case LineVoiceSource.bundled || LineVoiceSource.none:
        return;
    }
  }
}

/// The voice for lines of the course whose device locale is [locale] (the course's `voiceLocale`, null for a
/// dialect with no device voice). The bundled AI clips come first (natural voices, any learner, offline too); then
/// the server's AI voice (signed in; fetched once per line and cached on the server); the device's voice last.
/// Auto-disposed: a screen opened later asks the device again.
final lineVoiceProvider = FutureProvider.autoDispose.family<LineVoice, String?>((ref, locale) async {
  final speech = ref.watch(speechServiceProvider);
  final server = ref.watch(serverVoiceProvider);
  final bundled = ref.watch(bundledVoiceProvider);
  final device = locale != null && await ref.watch(voiceAvailableProvider(locale).future);
  if (server != null) return LineVoice(source: LineVoiceSource.server, server: server, bundled: bundled, locale: device ? locale : null, speech: speech);
  if (device) return LineVoice(source: LineVoiceSource.device, bundled: bundled, locale: locale, speech: speech);
  if (bundled != null) return LineVoice(source: LineVoiceSource.bundled, bundled: bundled, speech: speech);
  return LineVoice(source: LineVoiceSource.none, speech: speech);
});
