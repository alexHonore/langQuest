// PARKED — not reachable from the app since the learn path moved to the real curriculum (see README.md,
// "Parked prototype files"). It holds mock data or simulated behaviour (canned replies, simulated playback or
// voice levels, hand-copied catalog) that must not ship. Kept until the owner decides to delete or rewrite it.

import 'dart:async';
import 'package:audioplayers/audioplayers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

enum AudioPlayerStatus { idle, loading, playing, paused, error }

class TranscriptSegment {
  final int startMs;
  final int endMs;
  final String text;
  final String? translation;

  const TranscriptSegment({
    required this.startMs,
    required this.endMs,
    required this.text,
    this.translation,
  });
}

class AudioTrackItem {
  final String id;
  final String title;
  final String subtitle;
  final String courseTrackId;
  final String? audioUrl;
  final int durationMs;
  final List<TranscriptSegment> transcript;

  const AudioTrackItem({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.courseTrackId,
    this.audioUrl,
    required this.durationMs,
    this.transcript = const [],
  });
}

class AudioState {
  final AudioPlayerStatus status;
  final AudioTrackItem? currentItem;
  final int positionMs;
  final int durationMs;
  final double speed;
  final int activeTranscriptIndex;
  final String? errorMessage;

  const AudioState({
    this.status = AudioPlayerStatus.idle,
    this.currentItem,
    this.positionMs = 0,
    this.durationMs = 0,
    this.speed = 1.0,
    this.activeTranscriptIndex = -1,
    this.errorMessage,
  });

  AudioState copyWith({
    AudioPlayerStatus? status,
    AudioTrackItem? currentItem,
    int? positionMs,
    int? durationMs,
    double? speed,
    int? activeTranscriptIndex,
    String? errorMessage,
  }) {
    return AudioState(
      status: status ?? this.status,
      currentItem: currentItem ?? this.currentItem,
      positionMs: positionMs ?? this.positionMs,
      durationMs: durationMs ?? this.durationMs,
      speed: speed ?? this.speed,
      activeTranscriptIndex: activeTranscriptIndex ?? this.activeTranscriptIndex,
      errorMessage: errorMessage ?? this.errorMessage,
    );
  }
}

class AudioNotifier extends Notifier<AudioState> {
  final AudioPlayer _player = AudioPlayer();
  Timer? _positionSimTimer;

  @override
  AudioState build() {
    ref.onDispose(() {
      _positionSimTimer?.cancel();
      _player.dispose();
    });

    final sampleTrack = AudioTrackItem(
      id: 'lesson-1-audio',
      title: 'Arrival at the Café',
      subtitle: 'Natural Dialogue & Ordering',
      courseTrackId: 'french',
      audioUrl: 'audio/cafe_lesson.wav',
      durationMs: 96000,
      transcript: const [
        TranscriptSegment(
          startMs: 0,
          endMs: 4200,
          text: 'Bonjour ! Bienvenue au Café des Fleurs.',
          translation: 'Hello! Welcome to the Flower Café.',
        ),
        TranscriptSegment(
          startMs: 4300,
          endMs: 8500,
          text: 'Bonjour monsieur. Une table pour deux s’il vous plaît.',
          translation: 'Hello sir. A table for two please.',
        ),
        TranscriptSegment(
          startMs: 8600,
          endMs: 13200,
          text: 'Certainement. En terrasse ou à l’intérieur ?',
          translation: 'Certainly. On the terrace or inside?',
        ),
        TranscriptSegment(
          startMs: 13300,
          endMs: 18400,
          text: 'En terrasse, il fait très beau aujourd’hui !',
          translation: 'On the terrace, the weather is very nice today!',
        ),
        TranscriptSegment(
          startMs: 18500,
          endMs: 24000,
          text: 'Parfait ! Suivez-moi. Voici la carte.',
          translation: 'Perfect! Follow me. Here is the menu.',
        ),
        TranscriptSegment(
          startMs: 24100,
          endMs: 31000,
          text: 'Je vous conseille notre café crème et nos croissants chauds.',
          translation: 'I recommend our white coffee and warm croissants.',
        ),
      ],
    );

    return AudioState(
      currentItem: sampleTrack,
      durationMs: sampleTrack.durationMs,
      positionMs: 6200,
      activeTranscriptIndex: 1,
    );
  }

  void toggle() {
    if (state.status == AudioPlayerStatus.playing) {
      pause();
    } else {
      play();
    }
  }

  void play() async {
    state = state.copyWith(status: AudioPlayerStatus.playing);
    _startPositionTimer();
    try {
      final url = state.currentItem?.audioUrl ?? 'audio/cafe_lesson.wav';
      if (url.startsWith('http')) {
        await _player.play(UrlSource(url));
      } else {
        await _player.play(AssetSource(url));
      }
    } catch (_) {}
  }

  void pause() async {
    state = state.copyWith(status: AudioPlayerStatus.paused);
    _positionSimTimer?.cancel();
    try {
      await _player.pause();
    } catch (_) {}
  }

  void seekTo(int ms) {
    final clamped = ms.clamp(0, state.durationMs);
    state = state.copyWith(positionMs: clamped);
    _updateActiveTranscript(clamped);
  }

  void skipForward([int seconds = 10]) {
    seekTo(state.positionMs + seconds * 1000);
  }

  void skipBack([int seconds = 10]) {
    seekTo(state.positionMs - seconds * 1000);
  }

  void setSpeed(double speed) {
    state = state.copyWith(speed: speed);
    _player.setPlaybackRate(speed);
  }

  void loadTrack(AudioTrackItem track) {
    pause();
    state = state.copyWith(
      currentItem: track,
      durationMs: track.durationMs,
      positionMs: 0,
      activeTranscriptIndex: 0,
      status: AudioPlayerStatus.paused,
    );
  }

  void _startPositionTimer() {
    _positionSimTimer?.cancel();
    _positionSimTimer = Timer.periodic(const Duration(milliseconds: 200), (_) {
      if (state.status != AudioPlayerStatus.playing) return;
      final next = state.positionMs + (200 * state.speed).toInt();
      if (next >= state.durationMs) {
        seekTo(state.durationMs);
        pause();
      } else {
        state = state.copyWith(positionMs: next);
        _updateActiveTranscript(next);
      }
    });
  }

  void _updateActiveTranscript(int pos) {
    final transcript = state.currentItem?.transcript ?? [];
    int activeIdx = -1;
    for (int i = 0; i < transcript.length; i++) {
      if (pos >= transcript[i].startMs && pos <= transcript[i].endMs) {
        activeIdx = i;
        break;
      }
    }
    if (activeIdx != state.activeTranscriptIndex) {
      state = state.copyWith(activeTranscriptIndex: activeIdx);
    }
  }
}

final audioProvider = NotifierProvider<AudioNotifier, AudioState>(AudioNotifier.new);
