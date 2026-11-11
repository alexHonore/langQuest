// Fakes of the recorder, a take and the server's speech check, shared by the tests that record.
import 'dart:async';
import 'dart:typed_data';

import 'package:langquest_mobile/core/audio/take_recorder.dart';
import 'package:langquest_mobile/core/backend/speech_check.dart';

class FakeTake implements RecordedTake {
  FakeTake({this.duration = const Duration(seconds: 2), this.peakLevelDb = -14});

  @override
  final Duration duration;
  @override
  final double? peakLevelDb;
  @override
  String get mimeType => 'audio/webm;codecs=opus';
  @override
  Future<Uint8List> bytes() async => Uint8List.fromList(const [26, 69, 223, 163]);
  int plays = 0;
  bool disposed = false;
  Completer<void>? _playing;

  @override
  Future<void> play() {
    plays++;
    _playing = Completer<void>();
    return _playing!.future;
  }

  @override
  void stop() {
    if (_playing != null && !_playing!.isCompleted) _playing!.complete();
  }

  @override
  void dispose() {
    disposed = true;
    stop();
  }
}

class FakeRecorder implements TakeRecorder {
  FakeRecorder({this.failure, this.take});

  final RecorderFailure? failure;
  final RecordedTake? take;
  final _levels = StreamController<double>.broadcast();
  bool started = false;
  bool stopped = false;
  bool disposed = false;

  void level(double dbfs) => _levels.add(dbfs);

  @override
  Future<void> start() async {
    if (failure != null) throw RecorderException(failure!);
    started = true;
  }

  @override
  Stream<double> get levels => _levels.stream;

  @override
  Future<RecordedTake?> stop() async {
    stopped = true;
    return take;
  }

  @override
  Future<void> dispose() async {
    disposed = true;
    await _levels.close();
  }
}

/// The server's speech check: answers each take with the next of [verdicts] (null = the check fails), once [gate]
/// opens when one is given.
class FakeChecker implements SpeechChecker {
  FakeChecker(this.verdicts, {this.keepsRecordings = false});

  final List<SpeechVerdict?> verdicts;
  final checked = <(RecordedTake, SpeechTarget)>[];
  Completer<void>? gate;
  @override
  final bool keepsRecordings;

  @override
  Future<SpeechVerdict> check(RecordedTake take, SpeechTarget target) async {
    checked.add((take, target));
    if (gate != null) await gate!.future;
    final verdict = verdicts.removeAt(0);
    if (verdict == null) throw const SpeechCheckUnavailable('offline');
    return verdict;
  }
}
