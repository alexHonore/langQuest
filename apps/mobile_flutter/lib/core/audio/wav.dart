import 'dart:convert';
import 'dart:typed_data';

/// The server's synthetic voice returns some varieties as raw 16-bit PCM (`encoding: pcm16`, e.g. Darija), and a
/// conversation turn sends that PCM as `data:audio/wav;base64,…` without the WAV header a browser needs to decode it:
/// such a clip would play silent. These helpers give it the header.

/// 16-bit little-endian mono [pcm] at [sampleRate], as a WAV file.
Uint8List pcm16ToWav(Uint8List pcm, int sampleRate) {
  final header = ByteData(44);
  void ascii(int offset, String s) {
    for (var i = 0; i < s.length; i++) {
      header.setUint8(offset + i, s.codeUnitAt(i));
    }
  }

  ascii(0, 'RIFF');
  header.setUint32(4, 36 + pcm.length, Endian.little);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  header.setUint32(16, 16, Endian.little); // PCM fmt chunk size
  header.setUint16(20, 1, Endian.little); // PCM
  header.setUint16(22, 1, Endian.little); // mono
  header.setUint32(24, sampleRate, Endian.little);
  header.setUint32(28, sampleRate * 2, Endian.little); // byte rate
  header.setUint16(32, 2, Endian.little); // block align
  header.setUint16(34, 16, Endian.little); // bits per sample
  ascii(36, 'data');
  header.setUint32(40, pcm.length, Endian.little);
  return Uint8List.fromList([...header.buffer.asUint8List(), ...pcm]);
}

/// Whether [bytes] already are a WAV (RIFF) file.
bool isRiff(Uint8List bytes) => bytes.length >= 12 && bytes[0] == 0x52 && bytes[1] == 0x49 && bytes[2] == 0x46 && bytes[3] == 0x46;

/// The sample rate of [byteLength] bytes of 16-bit mono PCM lasting [durationMs], snapped to a standard rate.
int pcmSampleRate(int byteLength, int durationMs) {
  if (durationMs <= 0) return 24000;
  final measured = byteLength / 2 / (durationMs / 1000);
  const rates = [8000, 11025, 16000, 22050, 24000, 32000, 44100, 48000];
  return rates.reduce((a, b) => (measured - a).abs() <= (measured - b).abs() ? a : b);
}

/// A playable `data:` URL for the server's base64 audio of [encoding] (`pcm16` gets a WAV header).
String audioDataUrl(String base64Audio, {required String encoding, int? sampleRateHz, int? durationMs}) {
  if (encoding == 'pcm16') {
    final pcm = base64Decode(base64Audio);
    if (!isRiff(pcm)) {
      final rate = sampleRateHz ?? pcmSampleRate(pcm.length, durationMs ?? 0);
      return 'data:audio/wav;base64,${base64Encode(pcm16ToWav(pcm, rate))}';
    }
    return 'data:audio/wav;base64,$base64Audio';
  }
  final mime = switch (encoding) {
    'mp3' => 'audio/mpeg',
    'wav' => 'audio/wav',
    'opus' => 'audio/ogg',
    'aac' || 'm4a' => 'audio/mp4',
    'webm_opus' => 'audio/webm',
    'flac' => 'audio/flac',
    _ => 'audio/mpeg',
  };
  return 'data:$mime;base64,$base64Audio';
}

/// A conversation turn's audio URL made playable: a `data:audio/wav` URL holding raw PCM gets the WAV header (its
/// rate from the clip's [durationMs]); any other URL is returned as it is.
String playableTurnAudio(String url, {int? durationMs}) {
  const prefix = 'data:audio/wav;base64,';
  if (!url.startsWith(prefix)) return url;
  try {
    final bytes = base64Decode(url.substring(prefix.length));
    if (isRiff(bytes)) return url;
    return '$prefix${base64Encode(pcm16ToWav(bytes, pcmSampleRate(bytes.length, durationMs ?? 0)))}';
  } on FormatException {
    return url;
  }
}
