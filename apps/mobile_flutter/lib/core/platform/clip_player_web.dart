import 'dart:async';
import 'dart:js_interop';
import 'dart:math' as math;

import 'package:web/web.dart' as web;

import '../audio/clip_player.dart';

bool get canPlayClips => true;

ClipPlayer createClipPlayer() => _WebClipPlayer();

/// An audio element, metered through Web Audio when it can be (a `data:` clip is same-origin; a cross-origin URL
/// without CORS would play silent through an analyser, so it is played unmetered and the level is simulated).
class _WebClipPlayer implements ClipPlayer {
  final _levels = StreamController<double>.broadcast();
  final _progress = StreamController<double>.broadcast();
  web.AudioContext? _context;
  web.HTMLAudioElement? _audio;
  Completer<void>? _done;
  Timer? _meter;
  bool _disposed = false;

  @override
  Stream<double> get levels => _levels.stream;

  @override
  Stream<double> get progress => _progress.stream;

  @override
  void prime() {
    try {
      final context = _context ??= web.AudioContext();
      if (context.state == 'suspended') context.resume().toDart.ignore();
    } catch (_) {
      // No Web Audio: clips play unmetered.
    }
  }

  @override
  Future<void> play(String url, {double rate = 1}) async {
    if (_disposed) return;
    stop();
    final done = Completer<void>();
    // A slower rate keeps the voice's pitch (browsers preserve it by default; set for those that do not).
    final audio = web.HTMLAudioElement()
      ..src = url
      ..playbackRate = rate
      ..defaultPlaybackRate = rate
      ..preservesPitch = true;
    _audio = audio;
    _done = done;
    void finish() {
      _meter?.cancel();
      _meter = null;
      if (!_levels.isClosed) _levels.add(0);
      if (!done.isCompleted) done.complete();
    }

    audio.addEventListener('ended', ((web.Event _) => finish()).toJS);
    audio.addEventListener('error', ((web.Event _) => finish()).toJS);
    final analyser = url.startsWith('data:') ? _analyserFor(audio) : null;
    final samples = analyser == null ? null : JSFloat32Array.withLength(analyser.fftSize);
    var tick = 0;
    _meter = Timer.periodic(const Duration(milliseconds: 50), (_) {
      tick++;
      final duration = audio.duration;
      if (duration.isFinite && duration > 0 && !_progress.isClosed) _progress.add((audio.currentTime / duration).clamp(0.0, 1.0));
      if (audio.paused || _levels.isClosed) return;
      if (analyser != null && samples != null) {
        analyser.getFloatTimeDomainData(samples);
        var peak = 0.0;
        for (final sample in samples.toDart) {
          if (sample.abs() > peak) peak = sample.abs();
        }
        _levels.add(math.min(1, peak * 1.6));
      } else {
        // No meter: a speech-like rhythm, so the mouth still moves while the line plays.
        _levels.add(0.35 + 0.35 * math.sin(tick * 1.7).abs());
      }
    });
    try {
      await audio.play().toDart;
    } catch (_) {
      finish();
    }
    return done.future;
  }

  web.AnalyserNode? _analyserFor(web.HTMLAudioElement audio) {
    try {
      final context = _context ??= web.AudioContext();
      if (context.state == 'suspended') context.resume().toDart.ignore();
      final analyser = context.createAnalyser()..fftSize = 1024;
      context.createMediaElementSource(audio)
        ..connect(analyser)
        ..connect(context.destination);
      return analyser;
    } catch (_) {
      return null;
    }
  }

  @override
  void stop() {
    final audio = _audio;
    _audio = null;
    audio?.pause();
    _meter?.cancel();
    _meter = null;
    final done = _done;
    if (done != null && !done.isCompleted) done.complete();
    if (!_levels.isClosed) _levels.add(0);
  }

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    stop();
    _levels.close();
    _progress.close();
    final context = _context;
    _context = null;
    if (context != null && context.state != 'closed') context.close().toDart.ignore();
  }
}
