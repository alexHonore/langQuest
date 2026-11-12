import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_tts/flutter_tts.dart';

/// On-device speech for the learn path: the scene character's lines (L1), tap-to-hear on cards and games (L3),
/// the mission's model lines and review answers. Where the device has no voice for the course, a signed-in learner
/// hears the server's AI voice instead (`core/backend/server_voice.dart`).
///
/// A voice is used only when the device has one for the course's exact locale (`es-ES` never falls back to a
/// Latin American voice; colloquial Arabic courses carry no voice locale at all, because phone Arabic voices
/// speak MSA — variety boundaries, ADR-006). Without a matching voice the listen controls are not rendered
/// (CONVENTIONS §8: visible means usable).
class SpeechService {
  SpeechService({FlutterTts? tts, this.voiceRetryDelay = const Duration(milliseconds: 400)}) : _tts = tts ?? FlutterTts();

  final FlutterTts _tts;
  bool _configured = false;
  final _stopListeners = <void Function()>{};

  /// Also stopped whenever the device voice is (the server's AI voice, which stands in for it).
  void addStopListener(void Function() listener) => _stopListeners.add(listener);
  void removeStopListener(void Function() listener) => _stopListeners.remove(listener);
  Future<Set<String>>? _voiceLocales;

  /// Browsers list no voices until they have loaded them (Chrome fills the list asynchronously), and some
  /// Android engines until they have started: an empty list is asked again a few times before it counts.
  static const int voiceListAttempts = 6;
  final Duration voiceRetryDelay;

  /// flutter_tts rates: on iOS and Android 0.5 is the normal pace; in a browser the rate is the Web Speech API's,
  /// where 1 is normal (0.5 there was already half speed, so "Slowly" barely differed).
  static double get normalRate => kIsWeb ? 1.0 : 0.5;
  static double get slowRate => kIsWeb ? 0.6 : 0.3;

  Future<void> _configure() async {
    if (_configured) return;
    _configured = true;
    try {
      // Play even with the ring/silent switch on, like the rest of the app's audio.
      await _tts.setIosAudioCategory(IosTextToSpeechAudioCategory.playback, [
        IosTextToSpeechAudioCategoryOptions.defaultToSpeaker,
      ], IosTextToSpeechAudioMode.defaultMode);
    } catch (_) {
      // Not iOS, or the category is already set: speaking still works.
    }
    try {
      await _tts.awaitSpeakCompletion(true);
    } catch (_) {}
  }

  /// Normalized locale tag (`es_ES` → `es-es`).
  static String normalizeLocale(String tag) => tag.replaceAll('_', '-').toLowerCase();

  /// The locales of the device's voices; null when there is no speech engine at all (nothing to wait for).
  Future<Set<String>?> _readVoiceLocales() async {
    try {
      final voices = await _tts.getVoices;
      if (voices is! List) return const {};
      return {
        for (final v in voices)
          if (v is Map && v['locale'] is String) normalizeLocale(v['locale'] as String),
      };
    } catch (_) {
      return null;
    }
  }

  Future<Set<String>> _loadVoiceLocales() async {
    for (var attempt = 1; ; attempt++) {
      final locales = await _readVoiceLocales();
      if (locales == null) return const {};
      if (locales.isNotEmpty || attempt >= voiceListAttempts) return locales;
      await Future<void>.delayed(voiceRetryDelay);
    }
  }

  /// Whether the device has a voice for exactly [locale] (e.g. `es-ES`). Null means "no voice may be used".
  Future<bool> supports(String? locale) async {
    if (locale == null || locale.isEmpty) return false;
    final locales = await (_voiceLocales ??= _loadVoiceLocales());
    // Never keep an empty answer: the next screen asks again (the engine may have finished starting by then).
    if (locales.isEmpty) _voiceLocales = null;
    return locales.contains(normalizeLocale(locale));
  }

  /// A device voice for [language] in any region (`en` → `en-US`), for narration in the learner's own language;
  /// null when the device has none.
  Future<String?> voiceForLanguage(String language) async {
    final locales = await (_voiceLocales ??= _loadVoiceLocales());
    if (locales.isEmpty) _voiceLocales = null;
    const preferred = {
      'en': ['en-us', 'en-gb'],
      'fr': ['fr-fr', 'fr-ca'],
    };
    final match = [...?preferred[language], ...locales.where((l) => l == language || l.startsWith('$language-')).toList()..sort()].where(locales.contains);
    if (match.isEmpty) return null;
    final parts = match.first.split('-');
    return parts.length < 2 ? parts.first : '${parts.first}-${parts.sublist(1).join('-').toUpperCase()}';
  }

  /// Speak [text]; completes when the utterance ends (or is stopped).
  Future<void> speak(String text, {required String locale, bool slow = false}) async {
    await _configure();
    try {
      await _tts.stop();
      await _tts.setLanguage(locale);
      await _tts.setSpeechRate(slow ? slowRate : normalRate);
      await _tts.speak(text);
    } catch (_) {
      // A synthesizer failure must never break the lesson; the text stays on screen.
    }
  }

  Future<void> stop() async {
    for (final listener in [..._stopListeners]) {
      listener();
    }
    try {
      await _tts.stop();
    } catch (_) {}
  }
}

final speechServiceProvider = Provider<SpeechService>((ref) {
  final service = SpeechService();
  ref.onDispose(service.stop);
  return service;
});

/// Whether a voice exists for a locale on this device (drives whether listen buttons exist at all).
/// Auto-disposed so a screen opened later asks again (the engine may have finished starting meanwhile).
final voiceAvailableProvider = FutureProvider.autoDispose.family<bool, String?>((ref, locale) {
  return ref.read(speechServiceProvider).supports(locale);
});
