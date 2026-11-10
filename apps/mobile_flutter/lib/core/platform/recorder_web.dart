import 'dart:async';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:web/web.dart' as web;

import '../audio/take_recorder.dart';

/// The browser can record: a secure context (https or localhost) with the microphone API and MediaRecorder.
bool get canRecordTakes {
  try {
    final window = web.window;
    return window.isSecureContext && window.navigator.has('mediaDevices') && window.has('MediaRecorder');
  } catch (_) {
    return false;
  }
}

TakeRecorder createTakeRecorder() => _WebTakeRecorder();

/// getUserMedia refusals are DOMExceptions named NotAllowedError (refused), NotFoundError (no microphone), …
RecorderFailure _failureOf(Object error) {
  var name = '';
  try {
    name = '${(error as JSObject).getProperty<JSAny?>('name'.toJS).dartify()}';
  } catch (_) {}
  final text = '$name $error';
  if (text.contains('NotAllowedError') || text.contains('SecurityError') || text.contains('PermissionDenied')) {
    return RecorderFailure.blocked;
  }
  if (text.contains('NotFoundError') || text.contains('DevicesNotFound') || text.contains('OverconstrainedError')) {
    return RecorderFailure.noMicrophone;
  }
  return RecorderFailure.failed;
}

class _WebTakeRecorder implements TakeRecorder {
  web.AudioContext? _context;
  web.MediaStream? _stream;
  web.MediaRecorder? _recorder;
  Completer<void>? _stopped;
  Timer? _meter;
  final _chunks = <web.Blob>[];
  final _levels = StreamController<double>.broadcast();
  final _clock = Stopwatch();
  double _peak = 0;
  bool _measured = false;
  bool _disposed = false;

  @override
  Stream<double> get levels => _levels.stream;

  @override
  Future<void> start() async {
    if (_recorder != null || _disposed) return;
    // Made inside the learner's tap, before any await: browsers only start audio from a gesture.
    web.AudioContext? context;
    try {
      context = web.AudioContext();
    } catch (_) {}
    _context = context;
    final web.MediaStream stream;
    try {
      stream = await web.window.navigator.mediaDevices.getUserMedia(web.MediaStreamConstraints(audio: true.toJS)).toDart;
    } catch (error) {
      _release();
      throw RecorderException(_failureOf(error));
    }
    _stream = stream;
    if (_disposed) {
      // Closed while the browser was asking for the microphone: give it back at once.
      _release();
      throw const RecorderException(RecorderFailure.failed);
    }
    try {
      final recorder = web.MediaRecorder(stream);
      final stopped = Completer<void>();
      recorder.addEventListener(
        'dataavailable',
        ((web.BlobEvent event) {
          if (event.data.size > 0) _chunks.add(event.data);
        }).toJS,
      );
      recorder.addEventListener(
        'stop',
        ((web.Event _) {
          if (!stopped.isCompleted) stopped.complete();
        }).toJS,
      );
      recorder.start();
      _recorder = recorder;
      _stopped = stopped;
      _peak = 0;
      _measured = false;
      _clock
        ..reset()
        ..start();
    } catch (_) {
      _release();
      throw const RecorderException(RecorderFailure.failed);
    }
    if (context != null) _meterFrom(context, stream);
  }

  /// The peak of each 50 ms of input, from an analyser on the same stream (MediaRecorder reports no level).
  void _meterFrom(web.AudioContext context, web.MediaStream stream) {
    try {
      if (context.state == 'suspended') context.resume().toDart.ignore();
      final analyser = context.createAnalyser()..fftSize = 2048;
      context.createMediaStreamSource(stream).connect(analyser);
      final samples = JSFloat32Array.withLength(analyser.fftSize);
      _meter = Timer.periodic(const Duration(milliseconds: 50), (_) {
        if (context.state != 'running') return;
        analyser.getFloatTimeDomainData(samples);
        var peak = 0.0;
        for (final sample in samples.toDart) {
          final magnitude = sample.abs();
          if (magnitude > peak) peak = magnitude;
        }
        _measured = true;
        if (peak > _peak) _peak = peak;
        if (!_levels.isClosed) _levels.add(peakToDbfs(peak));
      });
    } catch (_) {
      // No level: the take is still recorded, only not measured.
    }
  }

  @override
  Future<RecordedTake?> stop() async {
    final recorder = _recorder;
    if (recorder == null) return null;
    _recorder = null;
    _meter?.cancel();
    _clock.stop();
    try {
      if (recorder.state != 'inactive') recorder.stop();
      await _stopped!.future.timeout(const Duration(seconds: 2));
    } catch (_) {
      // The chunks received so far are the take.
    }
    final peak = _measured ? peakToDbfs(_peak) : null;
    _release();
    if (_chunks.isEmpty) return null;
    final blob = web.Blob(_chunks.toJS, web.BlobPropertyBag(type: recorder.mimeType));
    _chunks.clear();
    return _WebTake(web.URL.createObjectURL(blob), _clock.elapsed, peak);
  }

  /// Stops the microphone (the browser's recording indicator goes off) and the level analyser.
  void _release() {
    _meter?.cancel();
    _meter = null;
    final stream = _stream;
    _stream = null;
    if (stream != null) {
      for (final track in stream.getTracks().toDart) {
        track.stop();
      }
    }
    final context = _context;
    _context = null;
    if (context != null && context.state != 'closed') context.close().toDart.ignore();
  }

  @override
  Future<void> dispose() async {
    _disposed = true;
    final recorder = _recorder;
    _recorder = null;
    try {
      if (recorder != null && recorder.state != 'inactive') recorder.stop();
    } catch (_) {}
    _chunks.clear();
    _release();
    await _levels.close();
  }
}

class _WebTake implements RecordedTake {
  _WebTake(this._url, this.duration, this.peakLevelDb);

  final String _url;
  @override
  final Duration duration;
  @override
  final double? peakLevelDb;
  web.HTMLAudioElement? _audio;
  Completer<void>? _done;
  bool _disposed = false;

  @override
  Future<void> play() async {
    if (_disposed) return;
    stop();
    final done = Completer<void>();
    void finish() {
      if (!done.isCompleted) done.complete();
    }

    final audio = web.HTMLAudioElement()..src = _url;
    audio.addEventListener('ended', ((web.Event _) => finish()).toJS);
    audio.addEventListener('error', ((web.Event _) => finish()).toJS);
    _audio = audio;
    _done = done;
    try {
      await audio.play().toDart;
    } catch (_) {
      finish();
    }
    return done.future;
  }

  @override
  void stop() {
    final audio = _audio;
    _audio = null;
    audio?.pause();
    final done = _done;
    if (done != null && !done.isCompleted) done.complete();
  }

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    stop();
    web.URL.revokeObjectURL(_url);
  }
}
