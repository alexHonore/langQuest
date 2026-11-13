import 'dart:async';
import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../l10n/generated/app_localizations.dart';
import '../audio/clip_player.dart';
import '../audio/clip_player_provider.dart';
import '../audio/wav.dart';
import '../content/content_bundle.dart';
import '../content/content_source.dart';
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

/// The server's AI narrator (`POST /v1/speech/narrate`, in the enrollment's instruction language). Each clip is
/// fetched once per session and kept in memory. Where the server cannot narrate, nothing is said: the device's
/// synthetic voice is never used for narration (the learner reads the text instead).
class ServerNarrator implements Narrator {
  ServerNarrator({required this.api, required this.course, required this.player});

  final LangQuestApi api;
  final ServerCourse course;
  final ClipPlayer player;
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
      // No narrator voice on this deployment or for this language (501), or a server without the route (404): nothing
      // is narrated from now on.
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
    if (url != null) await player.play(url);
  }

  @override
  void stop() {
    _generation++;
    player.stop();
  }
}

/// A course's recorded narration in one instruction language (`assets/content/narration/<lang>/<track>.json`, made by
/// `scripts/src/synthesize-narration.ts`): each sentence the narrator says, read once by a natural AI voice. Played
/// for every learner, signed in or not.
class BundledNarration {
  const BundledNarration(this.clips);

  static const empty = BundledNarration({});

  /// Sentence → clip (`assets/audio/narration/<voice>-<hash>.mp3`).
  final Map<String, String> clips;

  String? clipOf(String text) => clips[text];

  bool get isEmpty => clips.isEmpty;

  static String asset(String trackId, String source) => 'assets/content/narration/$source/$trackId.json';

  factory BundledNarration.parse(String source) {
    final json = (jsonDecode(source) as Map).cast<String, Object?>();
    if (json['schemaVersion'] != 1) throw FormatException('Unsupported narration schemaVersion ${json['schemaVersion']}');
    final clips = json['clips'] is Map ? json['clips'] as Map : const {};
    return BundledNarration({
      for (final e in clips.entries)
        if (e.value is String) '${e.key}': e.value as String,
    });
  }
}

/// The recorded narration of (track, instruction language), read when the course is active; empty when the course
/// has none yet (the server's AI narrator, signed in, or nothing).
final bundledNarrationProvider = FutureProvider.autoDispose.family<BundledNarration, (String, String)>((ref, course) async {
  // Only a narration the course's voices file lists: no request for a file that does not exist.
  if (!ref.watch(contentBundleProvider.select((b) => b.voices.hasNarration(course.$1, course.$2)))) return BundledNarration.empty;
  final read = ref.read(contentBundleProvider.notifier).read;
  if (read == null) return BundledNarration.empty;
  try {
    return BundledNarration.parse(await read(BundledNarration.asset(course.$1, course.$2)));
  } catch (e) {
    debugPrint('No recorded narration for ${course.$1} from ${course.$2}: $e');
    return BundledNarration.empty;
  }
});

/// The recorded narrator: a sentence's recorded clip, else the server's AI narrator ([server], signed in), else nothing.
class BundledNarrator implements Narrator {
  BundledNarrator({required this.narration, required this.player, required this.location, this.server});

  final BundledNarration narration;
  final ClipPlayer player;
  final ContentLocation location;
  final Narrator? server;

  @override
  bool get ai => true;

  @override
  Future<void> say(String text) async {
    final clip = narration.clipOf(text);
    if (clip == null) return server?.say(text);
    server?.stop();
    player.stop();
    await player.play(location.clip(clip).toString());
  }

  @override
  void prepare(String text) {
    if (narration.clipOf(text) == null) server?.prepare(text);
  }

  @override
  void stop() {
    player.stop();
    server?.stop();
  }
}

/// The narrator for the active course: its recorded narration (any learner), with the server's AI narrator for what is
/// not recorded (signed in, on a course it voices). Null when there is neither: the device's synthetic voice never
/// narrates, it sounds robotic next to the course's natural clips.
final narratorProvider = Provider<Narrator?>((ref) {
  final active = ref.watch(appStateProvider.select((s) => s.activeCourse));
  if (active == null) return null;
  final speech = ref.watch(speechServiceProvider);
  final makePlayer = ref.watch(clipPlayerFactoryProvider);
  if (makePlayer == null) return null;
  final api = ref.watch(apiProvider);
  final course = ref.watch(accountProvider).serverCourse(active.id);
  final offer = ref.watch(serverOffersProvider(active.source)).asData?.value[active.track.id];
  final recorded = ref.watch(bundledNarrationProvider((active.track.id, active.source))).asData?.value ?? BundledNarration.empty;
  final players = <ClipPlayer>[];
  ClipPlayer player() {
    final p = makePlayer();
    players.add(p);
    return p;
  }

  final ServerNarrator? server = api == null || course == null || offer == null || !offer.aiVoice
      ? null
      : ServerNarrator(api: api, course: course, player: player());
  final Narrator? narrator = recorded.isEmpty
      ? server
      : BundledNarrator(narration: recorded, player: player(), location: ref.watch(contentLocationProvider), server: server);
  if (narrator == null) return null;
  // Whatever stops the course's voice (a new line, a recording starting) stops the narrator too.
  speech.addStopListener(narrator.stop);
  ref.onDispose(() {
    speech.removeStopListener(narrator.stop);
    for (final p in players) {
      p.dispose();
    }
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

/// Whether exercises can be read aloud for the active course here: a natural narrator (recorded, or the server's AI
/// voice) and the app's words in the instruction language (the read-aloud button exists only then).
final narrationAvailableProvider = FutureProvider.autoDispose<bool>((ref) async {
  final source = ref.watch(appStateProvider.select((s) => s.activeCourse?.source));
  final narrator = ref.watch(narratorProvider);
  if (source == null || narrator == null || narrationWords(source) == null) return false;
  return narrator.ai;
});
