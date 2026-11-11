/// Playing a character's synthesized lines in a live conversation, with the output level for lip-sync.
library;

/// Plays one clip at a time.
abstract class ClipPlayer {
  /// Readies audio output; call it from the learner's tap (browsers start audio only from a gesture).
  void prime();

  /// Plays [url] (a `data:` URL of the server's audio, an https URL or a bundled asset's URL); completes when the clip
  /// ends, fails or is stopped. [rate] below 1 plays it slower at the same pitch (the "Slowly" button).
  Future<void> play(String url, {double rate = 1});

  /// The output level while playing, 0–1, about twenty times a second (the portrait's mouth follows it).
  Stream<double> get levels;

  /// How far the clip has played, 0–1 (the subtitle follows it).
  Stream<double> get progress;

  /// Stops the clip playing now (play's future completes).
  void stop();

  void dispose();
}
