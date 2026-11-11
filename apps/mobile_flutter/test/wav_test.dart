import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:langquest_mobile/core/audio/wav.dart';

/// The server's voice for Darija answers raw 16-bit PCM (`pcm16`): the app gives it a WAV header so a browser plays it.
void main() {
  // 1.2 s of 24 kHz mono 16-bit PCM, as the live server sent «السلام عليكم» (57,600 bytes).
  final pcm = Uint8List(57600);

  test('raw PCM becomes a WAV a browser can decode', () {
    final wav = pcm16ToWav(pcm, 24000);
    final header = ByteData.sublistView(wav, 0, 44);
    expect(String.fromCharCodes(wav.sublist(0, 4)), 'RIFF');
    expect(String.fromCharCodes(wav.sublist(8, 12)), 'WAVE');
    expect(header.getUint16(20, Endian.little), 1, reason: 'PCM');
    expect(header.getUint16(22, Endian.little), 1, reason: 'mono');
    expect(header.getUint32(24, Endian.little), 24000);
    expect(header.getUint16(34, Endian.little), 16);
    expect(header.getUint32(40, Endian.little), pcm.length);
    expect(wav.length, 44 + pcm.length);
    expect(isRiff(wav), isTrue);
    expect(isRiff(pcm), isFalse);
  });

  test('the sample rate of a clip, from its length and duration', () {
    expect(pcmSampleRate(57600, 1200), 24000);
    expect(pcmSampleRate(32000, 1000), 16000);
    expect(pcmSampleRate(88200 * 2, 2000), 44100);
  });

  test('synthesis: pcm16 gets a header (at the given rate); other encodings keep their bytes', () {
    final url = audioDataUrl(base64Encode(pcm), encoding: 'pcm16', sampleRateHz: 24000, durationMs: 1200);
    expect(url, startsWith('data:audio/wav;base64,'));
    expect(isRiff(base64Decode(url.substring('data:audio/wav;base64,'.length))), isTrue);
    expect(audioDataUrl('AAAA', encoding: 'mp3'), 'data:audio/mpeg;base64,AAAA');
  });

  test('a conversation turn\'s "audio/wav" URL holding raw PCM is fixed; a real WAV or an https URL is left alone', () {
    final raw = 'data:audio/wav;base64,${base64Encode(pcm)}';
    final fixed = playableTurnAudio(raw, durationMs: 1200);
    final bytes = base64Decode(fixed.substring('data:audio/wav;base64,'.length));
    expect(isRiff(bytes), isTrue);
    expect(ByteData.sublistView(bytes, 0, 44).getUint32(24, Endian.little), 24000);
    expect(playableTurnAudio(fixed), fixed);
    expect(playableTurnAudio('data:audio/mpeg;base64,AAAA'), 'data:audio/mpeg;base64,AAAA');
    expect(playableTurnAudio('https://media.test/a.mp3'), 'https://media.test/a.mp3');
  });
}
