/// Recording the learner's own voice, to compare with the reference (ADR-006: listen / record / compare, never a
/// score without an acoustic assessor). A take lives in memory on this device; it leaves it only when a signed-in
/// learner's course can have takes checked by the server (`core/backend/speech_check.dart`), and is never saved here.
library;

import 'dart:math' as math;
import 'dart:typed_data';

/// Why the microphone could not be used.
enum RecorderFailure {
  /// The learner or the browser refused the microphone.
  blocked,

  /// The device has no microphone.
  noMicrophone,

  /// Anything else (the microphone is busy, the recorder failed).
  failed,
}

class RecorderException implements Exception {
  const RecorderException(this.failure);
  final RecorderFailure failure;

  @override
  String toString() => 'RecorderException(${failure.name})';
}

/// Records one take at a time from the microphone.
abstract class TakeRecorder {
  /// Asks for the microphone (the browser asks the learner the first time) and starts recording. Throws a
  /// [RecorderException] when the microphone cannot be used.
  Future<void> start();

  /// The input level while recording, in dBFS, about twenty times a second.
  Stream<double> get levels;

  /// Stops and returns the take; null when nothing was captured.
  Future<RecordedTake?> stop();

  /// Releases the microphone, also when a recording is still running.
  Future<void> dispose();
}

/// One recording of the learner, held in memory.
abstract class RecordedTake {
  Duration get duration;

  /// The loudest input level of the take in dBFS; null when the level could not be measured.
  double? get peakLevelDb;

  /// The recording's container type, as the recorder made it (`audio/webm;codecs=opus`, `audio/mp4`…).
  String get mimeType;

  /// The recorded bytes (for a server check of what was said).
  Future<Uint8List> bytes();

  /// Plays the take; completes when it has ended or was stopped.
  Future<void> play();

  void stop();

  /// Stops playback and frees the recording.
  void dispose();
}

/// The lowest level the API accepts for `peakLevelDb` (`RecordingSignalsSchema`), used for digital silence.
const double minLevelDbfs = -200;

/// The server's silence floor (`SILENCE_PEAK_DBFS` in packages/ai speech-detection): a take whose peak stays at or
/// below it holds no speech, so the app says so instead of offering silence to compare with.
const double silencePeakDbfs = -50;

/// dBFS of a peak sample amplitude (1.0 = full scale).
double peakToDbfs(double peak) => peak <= 0 ? minLevelDbfs : math.max(minLevelDbfs, 20 * math.log(peak) / math.ln10);

/// Whether a take's peak shows it holds no speech (an unmeasured take is not called silent).
bool isSilentTake(double? peakLevelDb) => peakLevelDb != null && peakLevelDb <= silencePeakDbfs;

/// The API's `AudioEncoding` for a recording's container type; null when the API takes none like it.
String? apiEncodingFor(String mimeType) {
  final mime = mimeType.toLowerCase();
  if (mime.startsWith('audio/webm')) return 'webm_opus';
  if (mime.startsWith('audio/ogg')) return 'opus';
  if (mime.startsWith('audio/mp4') || mime.startsWith('audio/x-m4a') || mime.startsWith('audio/aac')) return 'm4a';
  if (mime.startsWith('audio/mpeg')) return 'mp3';
  if (mime.startsWith('audio/wav') || mime.startsWith('audio/x-wav') || mime.startsWith('audio/wave')) return 'wav';
  if (mime.startsWith('audio/flac')) return 'flac';
  return null;
}
