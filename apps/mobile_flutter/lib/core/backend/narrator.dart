import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../l10n/generated/app_localizations.dart';
import '../audio/clip_player.dart';
import '../audio/clip_player_provider.dart';
import '../audio/wav.dart';
import '../services/app_state.dart';
import '../services/speech_service.dart';
import 'account.dart';
import 'api_client.dart';
import 'server_course.dart';

/// The narrator: an exercise's context and question read aloud in the learner's instruction language ("At the café.
/// Karim says…", "How do you say “Good morning”?"). The phrases themselves are never narrated: they are said in the
/// course's own voice (`LineVoice`), so the narrator can never be mistaken for a model to imitate.
abstract class Narrator {
  /// Whether the server's AI voice narrates (else the device's voice for the instruction language).
  bool get ai;

  /// Says [text]; completes when it ends, is stopped, or at once when nothing can say it.
  Future<void> say(String text);

  /// Fetches [text]'s clip ahead of time (nothing to do for the device voice).
  void prepare(String text) {}

  void stop();
}

/// The device's voice for the instruction language (any region: `en` → `en-US`), when it has one.
class DeviceNarrator implements Narrator {
  DeviceNarrator({required this.speech, required this.language});

  final SpeechService speech;
  final String language;

  @override
  bool get ai => false;

  @override
  Future<void> say(String text) async {
    final locale = await speech.voiceForLanguage(language);
    if (locale != null) await speech.speak(text, locale: locale);
  }

  @override
  void prepare(String text) {}

  @override
  void stop() => unawaited(speech.stop());
}

/// The server's AI narrator (`POST /v1/speech/narrate`, in the enrollment's instruction language). Each clip is
/// fetched once per session and kept in memory. Where the server cannot narrate, the device's voice does.
class ServerNarrator implements Narrator {
  ServerNarrator({required this.api, required this.course, required this.player, this.fallback});

  final LangQuestApi api;
  final ServerCourse course;
  final ClipPlayer player;
  final Narrator? fallback;
  final _clips = <String, Future<String?>>{};
  bool _unsupported = false;

  /// Bumped by [stop]: a clip that arrives after it is not played.
  int _generation = 0;

  @override
  bool get ai => !_unsupported;

  Future<String?> _clip(String text) => _clips.putIfAbsent(
    text,
    () => _fetch(text).then((url) {
      if (url == null) _clips.remove(text); // asked again next time
      return url;
    }),
  );

  Future<String?> _fetch(String text) async {
    if (_unsupported) return null;
    try {
      final data = await api.narrate(enrollmentId: course.enrollmentId, text: text);
      final audio = data['audio'] is Map ? data['audio'] as Map : const {};
      final url = audio['url'];
      if (url is String && url.isNotEmpty) return url;
      final base64 = audio['base64'];
      if (base64 is! String || base64.isEmpty) return null;
      return audioDataUrl(
        base64,
        encoding: '${audio['encoding'] ?? 'mp3'}',
        sampleRateHz: (audio['sampleRateHz'] as num?)?.toInt(),
        durationMs: (audio['durationMs'] as num?)?.toInt(),
      );
    } on ApiException catch (e) {
      // No narrator voice on this deployment or for this language (501), or a server without the route (404): the
      // device narrates from now on.
      if (e.status == 501 || e.status == 404) _unsupported = true;
      return null;
    }
  }

  @override
  void prepare(String text) {
    if (!_unsupported) unawaited(_clip(text));
  }

  @override
  Future<void> say(String text) async {
    final generation = ++_generation;
    player.stop();
    final url = await _clip(text);
    if (generation != _generation) return;
    if (url != null) {
      await player.play(url);
    } else {
      await fallback?.say(text);
    }
  }

  @override
  void stop() {
    _generation++;
    player.stop();
  }
}

/// The narrator for the active course: the server's AI voice when signed in on a course it voices, else the device's
/// voice for the instruction language. Null without a course.
final narratorProvider = Provider<Narrator?>((ref) {
  final active = ref.watch(appStateProvider.select((s) => s.activeCourse));
  if (active == null) return null;
  final speech = ref.watch(speechServiceProvider);
  final device = DeviceNarrator(speech: speech, language: active.source);
  final api = ref.watch(apiProvider);
  final makePlayer = ref.watch(clipPlayerFactoryProvider);
  final course = ref.watch(accountProvider).serverCourse(active.id);
  final offer = ref.watch(serverOffersProvider(active.source)).asData?.value[active.track.id];
  if (api == null || makePlayer == null || course == null || offer == null || !offer.aiVoice) return device;
  final player = makePlayer();
  final narrator = ServerNarrator(api: api, course: course, player: player, fallback: device);
  // Whatever stops the course's voice (a new line, a recording starting) stops the narrator too.
  speech.addStopListener(narrator.stop);
  ref.onDispose(() {
    speech.removeStopListener(narrator.stop);
    player.dispose();
  });
  return narrator;
});

/// The app's words in the course's instruction language, for narration (the interface may be in another language);
/// null when the app has no translation in it (nothing is narrated then, rather than another language).
AppLocalizations? narrationWords(String source) {
  final locale = Locale(source);
  if (!AppLocalizations.supportedLocales.any((l) => l.languageCode == source)) return null;
  return lookupAppLocalizations(locale);
}

/// The narrator, when the learner wants exercises read aloud (Settings › Display) or asked for it ([asked]: the
/// read-aloud button), with the words to narrate in.
({Narrator narrator, AppLocalizations words})? readAloudFor(WidgetRef ref, {bool asked = false}) {
  final state = ref.read(appStateProvider);
  final course = state.activeCourse;
  if (!(state.learner.readAloud || asked) || course == null) return null;
  final narrator = ref.read(narratorProvider);
  final words = narrationWords(course.source);
  if (narrator == null || words == null) return null;
  return (narrator: narrator, words: words);
}

/// Whether exercises can be read aloud for the active course here: the AI narrator, or a device voice for the
/// instruction language, and the app's words in it (the read-aloud button exists only then).
final narrationAvailableProvider = FutureProvider.autoDispose<bool>((ref) async {
  final source = ref.watch(appStateProvider.select((s) => s.activeCourse?.source));
  final narrator = ref.watch(narratorProvider);
  if (source == null || narrator == null || narrationWords(source) == null) return false;
  if (narrator.ai) return true;
  return await ref.read(speechServiceProvider).voiceForLanguage(source) != null;
});
