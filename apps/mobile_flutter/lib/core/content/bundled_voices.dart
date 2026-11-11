import 'dart:convert';

/// The course lines read by natural AI voices and bundled with the app (`assets/content/voices.json`, made by
/// `scripts/src/synthesize-bundle-audio.ts`): one clip per line, the character and the learner's role in different
/// voices. They play for every learner, signed in or not, offline too. Synthetic, and said so.
class BundledVoices {
  const BundledVoices({this.clips = const {}, this.voiceOf = const {}});

  static const empty = BundledVoices();

  /// Expression id → asset path of its clip (`assets/audio/lines/<voice>-<hash>.mp3`).
  final Map<String, String> clips;

  /// Expression id → the voice id that reads it.
  final Map<String, String> voiceOf;

  String? clipOf(String? expressionId) => expressionId == null ? null : clips[expressionId];

  bool get isEmpty => clips.isEmpty;

  factory BundledVoices.parse(String source) {
    final json = (jsonDecode(source) as Map).cast<String, Object?>();
    if (json['schemaVersion'] != 1) throw FormatException('Unsupported voices schemaVersion ${json['schemaVersion']}');
    final lines = json['lines'] is Map ? json['lines'] as Map : const {};
    return BundledVoices(
      clips: {
        for (final e in lines.entries)
          if (e.value is Map && (e.value as Map)['file'] is String) '${e.key}': (e.value as Map)['file'] as String,
      },
      voiceOf: {
        for (final e in lines.entries)
          if (e.value is Map && (e.value as Map)['voice'] is String) '${e.key}': (e.value as Map)['voice'] as String,
      },
    );
  }
}
