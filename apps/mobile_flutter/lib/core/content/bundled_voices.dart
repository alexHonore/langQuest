import 'dart:convert';

/// The course lines read by natural AI voices (`assets/content/voices/<trackId>.json` for each course, split from the
/// `voices.json` made by
/// `scripts/src/synthesize-bundle-audio.ts`): one clip per line, the character and the learner's role in different
/// voices. They play for every learner, signed in or not, offline too. Synthetic, and said so.
class BundledVoices {
  const BundledVoices({this.clips = const {}, this.voiceOf = const {}, this.narration = const {}});

  static const empty = BundledVoices();

  /// Expression id → asset path of its clip (`assets/audio/lines/<voice>-<hash>.mp3`).
  final Map<String, String> clips;

  /// Expression id → the voice id that reads it.
  final Map<String, String> voiceOf;

  /// Course track → the instruction languages its narration is recorded in (`narration/<lang>/<track>.json`).
  final Map<String, Set<String>> narration;

  String? clipOf(String? expressionId) => expressionId == null ? null : clips[expressionId];

  /// Whether [trackId]'s narration is recorded in [source] (only then is its file read).
  bool hasNarration(String trackId, String source) => narration[trackId]?.contains(source) ?? false;

  bool get isEmpty => clips.isEmpty && narration.isEmpty;

  /// These voices and [other]'s (another course's).
  BundledVoices merge(BundledVoices other) => other.isEmpty
      ? this
      : (isEmpty
            ? other
            : BundledVoices(clips: {...clips, ...other.clips}, voiceOf: {...voiceOf, ...other.voiceOf}, narration: {...narration, ...other.narration}));

  /// These voices without the lines [expressionIds] and the narration of [trackId] (a course the learner left).
  BundledVoices without(Set<String> expressionIds, {String? trackId}) => expressionIds.isEmpty && !narration.containsKey(trackId)
      ? this
      : BundledVoices(
          clips: {
            for (final e in clips.entries)
              if (!expressionIds.contains(e.key)) e.key: e.value,
          },
          voiceOf: {
            for (final e in voiceOf.entries)
              if (!expressionIds.contains(e.key)) e.key: e.value,
          },
          narration: {...narration}..remove(trackId),
        );

  factory BundledVoices.parse(String source) {
    final json = (jsonDecode(source) as Map).cast<String, Object?>();
    if (json['schemaVersion'] != 1) throw FormatException('Unsupported voices schemaVersion ${json['schemaVersion']}');
    final lines = json['lines'] is Map ? json['lines'] as Map : const {};
    final track = json['courseTrackId'];
    final narration = json['narration'] is List
        ? {
            for (final l in json['narration'] as List)
              if (l is String) l,
          }
        : const <String>{};
    return BundledVoices(
      narration: track is String && narration.isNotEmpty ? {track: narration} : const {},
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
