import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_tts/flutter_tts.dart';

/// On-device speech for the learn path: the scene character's lines (L1) and tap-to-hear on the
/// discovery cards (L3). The phone's synthesizer is used because this prototype has no backend; the
/// voice is labelled as synthetic in the UI. When the device has no voice for the course locale, the
/// listen controls are not rendered at all (CONVENTIONS §8: visible means usable).
class SpeechService {
  final FlutterTts _tts = FlutterTts();
  bool _configured = false;

  static const double normalRate = 0.5;
  static const double slowRate = 0.32;

  Future<void> _configure() async {
    if (_configured) return;
    _configured = true;
    try {
      // Play even with the ring/silent switch on, like the rest of the app's audio.
      await _tts.setIosAudioCategory(
        IosTextToSpeechAudioCategory.playback,
        [IosTextToSpeechAudioCategoryOptions.defaultToSpeaker],
        IosTextToSpeechAudioMode.defaultMode,
      );
    } catch (_) {
      // Not iOS, or the category is already set: speaking still works.
    }
    await _tts.awaitSpeakCompletion(true);
  }

  /// Whether the device can speak this locale (e.g. `fr-FR`).
  Future<bool> supports(String locale) async {
    try {
      final result = await _tts.isLanguageAvailable(locale);
      return result == true || result == 1;
    } catch (_) {
      return false;
    }
  }

  /// Speak [text]; completes when the utterance ends (or is stopped).
  Future<void> speak(String text, {required String locale, bool slow = false}) async {
    await _configure();
    await _tts.stop();
    await _tts.setLanguage(locale);
    await _tts.setSpeechRate(slow ? slowRate : normalRate);
    await _tts.speak(text);
  }

  Future<void> stop() async {
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

/// Whether a voice exists for a locale on this device (drives whether listen buttons exist).
final voiceAvailableProvider = FutureProvider.family<bool, String>((ref, locale) {
  return ref.read(speechServiceProvider).supports(locale);
});
