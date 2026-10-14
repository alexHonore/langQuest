# OpenRouter speech API notes (extracted 2026-10-14 from official docs)


## Speech-to-text

```
# List only STT models
curl "https://openrouter.ai/api/v1/models?output_modalities=transcription"
```

```
import { OpenRouter } from '@openrouter/sdk';
    import fs from 'fs';
    const openRouter = new OpenRouter({
      apiKey: '{{API_KEY_REF}}',
    });
    const audioBuffer = await fs.promises.readFile('audio.wav');
    const base64Audio = audioBuffer.toString('base64');
    const result = await openRouter.stt.createTranscription({
      model: '{{MODEL}}',
      inputAudio: {
        data: base64Audio,
        format: 'wav',
      },
    });
    console.log(result.text);
```

```
import requests
    import base64
    import json
    with open("audio.wav", "rb") as f:
        base64_audio = base64.b64encode(f.read()).decode("utf-8")
    response = requests.post(
        url="https://openrouter.ai/api/v1/audio/transcriptions",
        headers={
            "Authorization": "Bearer {{API_KEY_REF}}",
            "Content-Type": "application/json"
        },
        data=json.dumps({
            "model": "{{MODEL}}",
            "input_audio": {
                "data": base64_audio,
                "format": "wav"
            }
        })
    )
    result = response.json()
    print(result["text"])
```

```
import fs from 'fs';
    const audioBuffer = await fs.promises.readFile('audio.wav');
    const base64Audio = audioBuffer.toString('base64');
    const response = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer {{API_KEY_REF}}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: '{{MODEL}}',
        input_audio: {
          data: base64Audio,
          format: 'wav',
        },
      }),
    });
    const result = await response.json();
    console.log(result.text);
```

```
# Base64-encode your audio file
    AUDIO_BASE64=$(base64 
### Request Parameters
| Parameter | Type | Required | Description |
| - | - | - | - |
| `model` | string | Yes | The STT model to use (e.g., `openai/whisper-1`) |
| `input_audio` | object | Yes | Audio data to transcribe |
| `input_audio.data` | string | Yes | Base64-encoded audio data (raw bytes, not a data URI) |
| `input_audio.format` | string | Yes | Audio format (e.g., `wav`, `mp3`, `flac`, `m4a`, `ogg`, `webm`, `aac`) |
| `language` | string | No | ISO-639-1 language code (e.g., `"en"`, `"ja"`). Auto-detected if omitted |
| `temperature` | number | No | Sampling temperature between 0 and 1. Lower values produce more deterministic results |
| `response_format` | string | No | `json` (default) or `verbose_json`. See [Verbose Transcripts](#verbose-transcripts-timestamps-and-speakers) |
| `timestamp_granularities` | string\[] | No | `["segment"]` and/or `["word"]`. Only used with `verbose_json` |
| `provider` | object | No | Data policy routing preferences (`zdr`, `data_collection`) and provider-specific options under `provider.options`. With `zdr: true`, the request only routes to [Zero Data Retention](/docs/guides/features/zdr) endpoints. Other routing preferences (`order`, `only`, `ignore`) are not applied to transcription requests. See [Provider-Specific Options](#provider-specific-options) |
### OpenAI-Compatible Multipart Requests
The endpoint also accepts OpenAI-style `multipart/form-data` requests, so clients built for OpenAI's `/v1/audio/transcriptions` (including the official OpenAI SDKs) work by pointing their base URL at `https://openrouter.ai/api/v1`:
```

```
The `file`, `model`, `language`, `temperature`, `response_format`, and `timestamp_granularities` fields are supported. `prompt` is accepted but ignored. `response_format` may be `json` (the default) or `verbose_json` (see [Verbose Transcripts](#verbose-transcripts-timestamps-and-speakers)). `text`, `srt`, and `vtt` are rejected with a 400. With `verbose_json`, pass `timestamp_granularities[]=word` to also receive word-level timestamps in the `words` array.
Multipart uploads are limited to 25 MB, the same cap OpenAI enforces. For compressed formats this covers long recordings, roughly 26 minutes of 128 kbps MP3, 52 minutes at 64 kbps, or over 2 hours of 24 kbps Opus voice notes. Uncompressed WAV fills the cap much faster (about 13 minutes at 16 kHz mono); prefer `mp3` or `opus` for long recordings. Larger files should be sent as base64 JSON via `input_audio` on OpenAI and Groq models, which offload the large body through a Durable Object and accept files past the 25 MB multipart cap, or as `input_audio.url` for models that accept a URL — the provider downloads it directly, so the 25 MB inline cap does not apply. On other providers, base64 JSON past the multipart cap is rejected, so those models are limited to the 25 MB multipart upload. Recordings longer than about a minute of processing time should be split anyway, since upstream providers time out after 60 seconds per request.
### Provider-Specific Options
Pass provider-specific parameters through `provider.options`, keyed by the provider slug from the endpoints API. Only the options for the provider that serves the request are forwarded, and they are sent under the provider's own field names, so use the names and shapes from that provider's transcription API reference. Parameters that OpenRouter normalizes across prov
```

```
Features a provider exposes only through its own options, such as speaker diarization, vocabulary or keyword hints, and output style controls, are passed this way. Provider integrations differ in which fields they forward and how they handle unsupported fields. Some forward only an allowlist and drop the rest without an error (for example Deepgram accepts `punctuate`, `diarize`, `smart_format`, and `detect_language`), while others such as Azure forward most fields as-is, so an invalid option usually surfaces as a provider error. Use the options shown in this guide, or test an option before relying on it.
### Verbose Transcripts (Timestamps and Speakers)
Set `response_format` to `verbose_json` to request structured fields such as `language`, `duration`, and a `segments` array with start and end times (OpenAI-compatible providers also return `task`). Which of these fields are present varies by provider. Add `"word"` to `timestamp_granularities` to also request a `words` array. Providers that do not return structured output reject `verbose_json` with a 400, as do some individual models (for example `openai/gpt-4o-transcribe` and `microsoft/mai-transcribe-1.5`).
Speaker diarization is enabled through the provider's own option under `provider.options` (see [Provider-Specific Options](#provider-specific-options)). When the provider returns speaker labels, each segment (and word, where the provider supports it) carries a `speaker` index. This example enables diarization on the `azure` endpoint of `microsoft/mai-transcribe-2`:
```

- OpenRouter supports speech-to-text (STT) via a dedicated `/api/v1/audio/transcriptions` endpoint. Send base64-encoded audio and receive a JSON response with the transcribed text and usage statistics.
- Send a `POST` request to `/api/v1/audio/transcriptions` with a JSON body containing base64-encoded audio. The response is JSON with the transcribed text and optional usage statistics.
- const base64Audio = audioBuffer.toString('base64');
- base64_audio = base64.b64encode(f.read()).decode("utf-8")
- const base64Audio = audioBuffer.toString('base64');
- | `input_audio.data` | string | Yes | Base64-encoded audio data (raw bytes, not a data URI) |
- | `language` | string | No | ISO-639-1 language code (e.g., `"en"`, `"ja"`). Auto-detected if omitted |
- | `response_format` | string | No | `json` (default) or `verbose_json`. See [Verbose Transcripts](#verbose-transcripts-timestamps-and-speakers) |
- | `timestamp_granularities` | string\[] | No | `["segment"]` and/or `["word"]`. Only used with `verbose_json` |
- | `provider` | object | No | Data policy routing preferences (`zdr`, `data_collection`) and provider-specific options under `provider.options`. With `zdr: true`, the request only routes to [Zero Data Retention](/docs/guides/features/zdr) endpoints. Other routing preferences (`order`, `only`, `ignore`) are not applied to transcription requests. See [Provider-Specific Options](#provider-specific-opt
- The `file`, `model`, `language`, `temperature`, `response_format`, and `timestamp_granularities` fields are supported. `prompt` is accepted but ignored. `response_format` may be `json` (the default) or `verbose_json` (see [Verbose Transcripts](#verbose-transcripts-timestamps-and-speakers)). `text`, `srt`, and `vtt` are rejected with a 400. With `verbose_json`, pass `timestamp_granularities[]=word`
- to also receive word-level timestamps in the `words` array.
- Multipart uploads are limited to 25 MB, the same cap OpenAI enforces. For compressed formats this covers long recordings, roughly 26 minutes of 128 kbps MP3, 52 minutes at 64 kbps, or over 2 hours of 24 kbps Opus voice notes. Uncompressed WAV fills the cap much faster (about 13 minutes at 16 kHz mono); prefer `mp3` or `opus` for long recordings. Larger files should be sent as base64 JSON via `inpu
- t_audio` on OpenAI and Groq models, which offload the large body through a Durable Object and accept files past the 25 MB multipart cap, or as `input_audio.url` for models that accept a URL — the provider downloads it directly, so the 25 MB inline cap does not apply. On other providers, base64 JSON past the multipart cap is rejected, so those models are limited to the 25 MB multipart upload. Recor
- dings longer than about a minute of processing time should be split anyway, since upstream providers time out after 60 seconds per request.
- Pass provider-specific parameters through `provider.options`, keyed by the provider slug from the endpoints API. Only the options for the provider that serves the request are forwarded, and they are sent under the provider's own field names, so use the names and shapes from that provider's transcription API reference. Parameters that OpenRouter normalizes across providers (`language`, `temperature
- `, `response_format`, `timestamp_granularities`) stay at the top level of the request.
- To find the slug for each provider serving a model, call the [endpoints API](/docs/api/api-reference/endpoints/list-all-endpoints-for-a-model). The `tag` field of each endpoint record is the key to use under `provider.options`:
- Features a provider exposes only through its own options, such as speaker diarization, vocabulary or keyword hints, and output style controls, are passed this way. Provider integrations differ in which fields they forward and how they handle unsupported fields. Some forward only an allowlist and drop the rest without an error (for example Deepgram accepts `punctuate`, `diarize`, `smart_format`, an
- d `detect_language`), while others such as Azure forward most fields as-is, so an invalid option usually surfaces as a provider error. Use the options shown in this guide, or test an option before relying on it.
- ### Verbose Transcripts (Timestamps and Speakers)
- Set `response_format` to `verbose_json` to request structured fields such as `language`, `duration`, and a `segments` array with start and end times (OpenAI-compatible providers also return `task`). Which of these fields are present varies by provider. Add `"word"` to `timestamp_granularities` to also request a `words` array. Providers that do not return structured output reject `verbose_json` wit
- Speaker diarization is enabled through the provider's own option under `provider.options` (see [Provider-Specific Options](#provider-specific-options)). When the provider returns speaker labels, each segment (and word, where the provider supports it) carries a `speaker` index. This example enables diarization on the `azure` endpoint of `microsoft/mai-transcribe-2`:
- AUDIO_BASE64=$(base64 < audio.mp3 | tr -d '\n')
- "timestamp_granularities": ["segment", "word"],
- { "word": "Hello", "start": 0.0, "end": 0.4, "speaker": 0 },
- { "word": "there.", "start": 0.4, "end": 1.2, "speaker": 0 }
- Whether speaker labels appear on segments, words, or both depends on the provider. Azure labels each phrase, and OpenRouter applies that label to the segment and to each word within it. Other providers' diarization options (for example Deepgram's `diarize`) are passed the same way under their provider slug.
- | `task` | string | `transcribe`. Only with `verbose_json`, when the provider reports it |
- | `language` | string | Detected or requested language. Only with `verbose_json` |
- | `confidence` | number | Provider confidence for the whole transcript, 0 to 1. Only with `verbose_json` and only when the provider scores the full transcript |
- | `segments` | array | Timestamped segments with `start`, `end`, `text`, and optional `speaker`. Only with `verbose_json` |
- | `words` | array | Timestamped words with `word`, `start`, `end`, optional `speaker`, and optional `confidence` (0 to 1, present when the provider scores words). Only with `verbose_json` and `"word"` in `timestamp_granularities` |
- Supported audio formats vary by provider. Common formats include:
- STT models use different pricing strategies depending on the provider:
- STT supports [BYOK](/docs/guides/overview/auth/byok), allowing you to use your own provider API keys. When configured, requests are routed directly to the provider using your key, and OpenRouter charges only its platform fee rather than the per-usage model cost.
- * **File size**: For very long audio files, consider splitting them into smaller segments. The upstream provider timeout is 60 seconds, so very large files may time out
- * **Base64 encoding**: Audio must be sent as base64-encoded data (raw bytes, not a data URI). Most programming languages have built-in base64 encoding utilities
- * Large audio files may exceed the 60-second timeout. Split long recordings into smaller segments

## Text-to-speech

```
# List only TTS models
curl "https://openrouter.ai/api/v1/models?output_modalities=speech"
```

```
import { OpenRouter } from '@openrouter/sdk';
    import fs from 'fs';
    const openRouter = new OpenRouter({
      apiKey: '{{API_KEY_REF}}',
    });
    const stream = await openRouter.tts.createSpeech({
      model: '{{MODEL}}',
      input: 'Hello! This is a text-to-speech test.',
      voice: 'alloy',
      responseFormat: 'mp3',
    });
    // Collect the audio stream and save to a file
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const buffer = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }
    await fs.promises.writeFile('output.mp3', buffer);
    console.log('Audio saved to output.mp3');
```

```
from openai import OpenAI
    client = OpenAI(
      base_url="https://openrouter.ai/api/v1",
      api_key="{{API_KEY_REF}}",
    )
    with client.audio.speech.with_streaming_response.create(
      model="{{MODEL}}",
      input="Hello! This is a text-to-speech test.",
      voice="alloy",
      response_format="mp3"
    ) as response:
      response.stream_to_file("output.mp3")
```

```
import requests
    response = requests.post(
      url="https://openrouter.ai/api/v1/audio/speech",
      headers={
        "Authorization": f"Bearer {API_KEY_REF}",
        "Content-Type": "application/json"
      },
      json={
        "model": "{{MODEL}}",
        "input": "Hello! This is a text-to-speech test.",
        "voice": "alloy",
        "response_format": "mp3"
      }
    )
    response.raise_for_status()
    with open("output.mp3", "wb") as f:
      f.write(response.content)
    generation_id = response.headers.get("X-Generation-Id")
    print(f"Audio saved. Generation ID: {generation_id}")
```

```
const response = await fetch('https://openrouter.ai/api/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY_REF}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: '{{MODEL}}',
        input: 'Hello! This is a text-to-speech test.',
        voice: 'alloy',
        response_format: 'mp3',
      }),
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(`TTS error ${response.status}: ${JSON.stringify(err)}`);
    }
    const audioBuffer = await response.arrayBuffer();
    const generationId = response.headers.get('X-Generation-Id');
    console.log(`Generation ID: ${generationId}`);
    // Save audioBuffer to a file or play it directly
```

```
curl https://openrouter.ai/api/v1/audio/speech \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $OPENROUTER_API_KEY" \
      --output output.mp3 \
      -d '{
        "model": "{{MODEL}}",
        "input": "Hello! This is a text-to-speech test.",
        "voice": "alloy",
        "response_format": "mp3"
      }'
```

```
{
  "model": "google/gemini-3.8-flash-lite-tts",
  "input": [
    { "text": "How's it going today, Jane?", "voice": "Kore" },
    { "text": "Not too bad, how about you?", "voice": "Puck", "instructions": "tired, yawning" }
  ],
  "instructions": "cheerful",
  "response_format": "pcm"
}
```

```
{
  "model": "fish-audio/s2.1-pro",
  "input": "Hello from my cloned voice!",
  "response_format": "mp3",
  "input_references": [
    { "type": "input_audio", "input_audio": { "data": "data:audio/wav;base64,UklGRuQXDAB..." } },
    { "type": "text", "text": "This is the transcript of the reference audio." }
  ]
}
```

- OpenRouter supports text-to-speech (TTS) via a dedicated `/api/v1/audio/speech` endpoint that is compatible with the [OpenAI Audio Speech API](https://platform.openai.com/docs/api-reference/audio/createSpeech). Send text and receive a raw audio byte stream in your chosen format.
- Send a `POST` request to `/api/v1/audio/speech` with the text you want to synthesize. The response is a raw audio byte stream (not JSON), so you can pipe it directly to a file or audio player.
- const stream = await openRouter.tts.createSpeech({
- // Collect the audio stream and save to a file
- with client.audio.speech.with_streaming_response.create(
- response.stream_to_file("output.mp3")
- | `voice` | string | Provider-dependent | Voice identifier. Available voices vary by model, so check each model's page on the [Models page](/docs/guides/overview/models) for supported voices. Omit this parameter only when the selected provider documents a default voice; otherwise an explicit voice is required. |
- | `instructions` | string | No | Delivery instructions such as tone, pacing, or emotion, for example `Speak in a warm and friendly tone.` Supported by OpenAI `gpt-4o-mini-tts`, Gemini TTS, and Fish Audio models. Ignored by other providers |
- | `speed` | number | No | Playback speed multiplier. Honored by models that support it (e.g., OpenAI TTS). Other providers either ignore it or return a 400 for a non-default value when the model has no speed control. Defaults to `1.0` |
- | `input_references` | array | No | Reference content for stateless voice cloning or voice design: one to three `input_audio` parts (each optionally paired with a `text` transcript), or exactly one `image_url` part. See [Voice Cloning](#voice-cloning) below |
- | `provider` | object | No | Data policy routing preferences (`zdr`, `data_collection`) and provider-specific passthrough options under `provider.options`. With `zdr: true`, the request only routes to [Zero Data Retention](/docs/guides/features/zdr) endpoints. Other routing preferences (`order`, `only`, `ignore`) are not applied to speech requests |
- When `voice` is omitted, OpenRouter only forwards the request to providers whose adapter supports a provider-side default voice. For other providers, the request is rejected with a validation error.
- Some models can voice a conversation between several speakers in one request. To use this, pass `input` as a list of turns instead of a string. Each turn has a `text` field and may set its own `voice` and `instructions`. A turn without a `voice` uses the top-level `voice`, and a turn without `instructions` uses the top-level `instructions`. The turns are synthesized in order into a single audio st
- { "text": "How's it going today, Jane?", "voice": "Kore" },
- { "text": "Not too bad, how about you?", "voice": "Puck", "instructions": "tired, yawning" }
- Multi-speaker input is supported by Gemini TTS models and by Fish Audio models other than S1. Other providers return a 400 error for it.
- Some models support **stateless voice cloning**: you send a short sample of reference audio directly with the TTS request, and the generated speech mimics that voice. No separate voice-creation or upload step is required.
- Pass the reference audio as a base64 `input_audio` part in `input_references` (a `data:audio/...;base64,` URI also works), and optionally include its transcript as a `text` part:
- "input": "Hello from my cloned voice!",
- { "type": "input_audio", "input_audio": { "data": "data:audio/wav;base64,UklGRuQXDAB..." } },
- Instead of inline base64, `input_audio` can carry a public `url`. OpenRouter downloads the file and forwards the bytes to the provider; the provider never receives your URL:
- Not every provider of a voice-cloning model supports voice cloning, and only some accept more than one clip or an image reference. Requests that carry references are only routed to endpoints whose capability flags allow them. Check these fields on the [endpoints API](/docs/docs/api-reference/list-endpoints-for-a-model):
- | `supports_voice_cloning` | The endpoint accepts `input_audio` reference clips |
- Models such as [Seed Audio 1.0](https://openrouter.ai/bytedance-seed/seed-audio-1-0) accept up to three `input_audio` clips in one request, so a single generation can switch between voices. Clips are numbered in the order you send them, and you address them from `input` with the placeholders `@Audio1`, `@Audio2`, and `@Audio3`. If you also send transcripts with more than one clip, place each clip'
- { "type": "input_audio", "input_audio": { "data": "data:audio/wav;base64,UklGRuQXDAB..." } },
- * With a single clip, the placeholder is optional: the whole input is spoken in that voice. If you include one, it must be `@Audio1`.
- * Transcripts are optional and provider-dependent: Fish Audio sends each clip's transcript to the model, while Seed Audio 1.0 ignores them. With a single clip the `text` part may appear before or after it; with multiple clips a `text` part must immediately follow its clip, and a transcript with no preceding clip is rejected.
- Some models can design a voice from a picture instead of an audio sample. Send exactly one `image_url` part, either as a base64 data URI or as a public `http(s)` URL that OpenRouter downloads and forwards as bytes. JPEG, PNG, and WebP are accepted:
- * Supported audio formats for reference clips are provider-specific.
- * Each inline reference is limited to 20 MiB of base64 (15 MiB of decoded media); a larger `data` value is rejected with a 400. Remote downloads are capped at the same 15 MiB and a larger file is rejected with a 413.
- * Seed Audio 1.0 treats both `voice` (a Seed speaker ID) and `input_references` as the reference voice, so a request that sends both is rejected with a 400. Use one or the other.
- When Seed Audio 1.0 rejects a reference or prompt for reasons of its own, such as a clip it cannot decode, OpenRouter returns a 400 whose message begins with `Provider rejected the request:` followed by the provider's explanation, with any base64 payload redacted. Other provider failures are reported with OpenRouter's own messages.
- For most TTS models, `input` is read aloud verbatim. Seed Audio 1.0 instead treats `input` as a prompt that is forwarded unchanged to the model, so it can describe the delivery of the speech, or describe sound that is not speech at all: sound effects, ambience, or a scene. Omit `voice` and `input_references` when you want the model to infer everything from the prompt:
- "input": "Heavy rain falling on a tin roof with distant rolling thunder, no voices.",
- You can pass provider-specific options using the `provider` parameter. Options are keyed by provider slug, and only the options for the matched provider are forwarded:
- Seed Audio 1.0 takes no provider options; every field it reads is derived from the standard parameters. It enforces these limits with a 400:
- Azure serves `microsoft/mai-voice-2`, `microsoft/mai-voice-2.1`, and `microsoft/mai-voice-2.1-flash`. Azure TTS uses SSML internally, but this is fully abstracted, so you only need the standard parameters. The `voice` parameter takes a full Azure voice ID with the model suffix (`:MAI-Voice-2`, `:MAI-Voice-2.1`, or `:MAI-Voice-2.1-Flash`, e.g., `en-US-Harper:MAI-Voice-2.1`), and the voice's locale
- sets the synthesis language. Set `response_format` to `mp3` or `pcm` (24 kHz mono). The full list of voices for each model is in the `supported_voices` field of the [models API](https://openrouter.ai/api/v1/models?output_modalities=speech).
- "voice": "en-US-Harper:MAI-Voice-2.1",
- Fish Audio models take delivery directions in square brackets inside the text, for example `[whispering] Nobody answered.` OpenRouter adds `instructions` to the text the same way, at the start of the input or of each turn. For [multi-speaker input](#multi-speaker-input), OpenRouter sends Fish one `reference_id` for each distinct turn voice and starts each turn with a `
- Gemini 3.8 TTS models read `input` verbatim, so delivery directions written into the text may be spoken aloud. Use the top-level `instructions` parameter instead, or the per-turn `instructions` for [multi-speaker input](#multi-speaker-input). OpenRouter sends it as `speech_metadata.style` on the input text part of the upstream request. Any other `speech_metadata` fields can be passed in provider o
- ptions and are merged onto the same text part. All remaining provider options are forwarded as generation config:
- For multi-speaker input, OpenRouter builds Gemini's `multiSpeakerVoiceConfig` from the turn voices, so no provider options are needed. If you pass your own `speechConfig` in provider options, it is forwarded as-is and replaces the one OpenRouter would build. Each turn is still labeled with its resolved voice name, so a custom `multiSpeakerVoiceConfig` must use those voice names as its `speaker` va
- The TTS endpoint returns a **raw audio byte stream**, not JSON. The response includes the following headers:
- | `pcm` | `audio/pcm` | Uncompressed raw audio. Lower latency, suitable for real-time streaming pipelines |
- Most TTS models are priced **per character** of input text. Some audio generation models, such as Seed Audio 1.0, are priced **per second** of generated audio instead. Pricing varies by model and provider. You can check the per-character or per-second cost for each model on the [Models page](/docs/guides/overview/models) or via the [Models API](/docs/api/api-reference/models/list-all-models-and-th
- # Non-streaming: get the full audio response
- # Streaming: process audio chunks as they arrive
- with client.audio.speech.with_streaming_response.create(
- response.stream_to_file("output.mp3")
- * **Choose the right format**: Use `mp3` for storage and general playback. Use `pcm` for real-time streaming pipelines where latency matters
- * **Voice selection**: Different providers offer different voices. Check the model's documentation or experiment with available voices to find the best fit for your use case
- * **Input length**: For very long texts, consider splitting the input into smaller segments and concatenating the audio output. This can improve reliability and reduce latency for the first audio chunk
- * **Speed parameter**: The `speed` parameter is only supported by certain providers (e.g., OpenAI). Providers that don't support it either ignore it or reject a non-default value with a 400 when the model has no speed control, so omit it unless the model documents speed
- * Available voices vary by provider. Check the provider's documentation for supported voice identifiers
- * Each model has its own set of voices, so check the model's page on the [Models page](/docs/guides/overview/models) for the full list

## Audio in chat

```
import { OpenRouter } from '@openrouter/sdk';
    import fs from "fs/promises";
    const openRouter = new OpenRouter({
      apiKey: '{{API_KEY_REF}}',
    });
    async function encodeAudioToBase64(audioPath: string): Promise
 {
      const audioBuffer = await fs.readFile(audioPath);
      return audioBuffer.toString("base64");
    }
    // Read and encode the audio file
    const audioPath = "path/to/your/audio.wav";
    const base64Audio = await encodeAudioToBase64(audioPath);
    const result = await openRouter.chat.send({
      chatRequest: {
        model: "{{MODEL}}",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Please transcribe this audio file.",
              },
              {
                type: "input_audio",
                inputAudio: {
                  data: base64Audio,
                  format: "wav",
                },
              },
            ],
          },
        ],
        stream: false,
      },
    });
    console.log(result);
```

```
import requests
    import json
    import base64
    def encode_audio_to_base64(audio_path):
        with open(audio_path, "rb") as audio_file:
            return base64.b64encode(audio_file.read()).decode('utf-8')
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {API_KEY_REF}",
        "Content-Type": "application/json"
    }
    # Read and encode the audio file
    audio_path = "path/to/your/audio.wav"
    base64_audio = encode_audio_to_base64(audio_path)
    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "Please transcribe this audio file."
                },
                {
                    "type": "input_audio",
                    "input_audio": {
                        "data": base64_audio,
                        "format": "wav"
                    }
                }
            ]
        }
    ]
    payload = {
        "model": "{{MODEL}}",
        "messages": messages
    }
    response = requests.post(url, headers=headers, json=payload)
    print(response.json())
```

```
import fs from "fs/promises";
    async function encodeAudioToBase64(audioPath: string): Promise
 {
      const audioBuffer = await fs.readFile(audioPath);
      return audioBuffer.toString("base64");
    }
    // Read and encode the audio file
    const audioPath = "path/to/your/audio.wav";
    const base64Audio = await encodeAudioToBase64(audioPath);
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY_REF}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "{{MODEL}}",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Please transcribe this audio file.",
              },
              {
                type: "input_audio",
                input_audio: {
                  data: base64Audio,
                  format: "wav",
                },
              },
            ],
          },
        ],
      }),
    });
    const data = await response.json();
    console.log(data);
```

```
import requests
    import json
    import base64
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {API_KEY_REF}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": "{{MODEL}}",
        "messages": [
            {
                "role": "user",
                "content": "Say hello in a friendly tone."
            }
        ],
        "modalities": ["text", "audio"],
        "audio": {
            "voice": "alloy",
            "format": "wav"
        },
        "stream": True
    }
    # Audio output requires streaming — the response is delivered as SSE chunks
    response = requests.post(url, headers=headers, json=payload, stream=True)
    audio_data_chunks = []
    transcript_chunks = []
    for line in response.iter_lines():
        if not line:
            continue
        decoded = line.decode("utf-8")
        if not decoded.startswith("data: "):
            continue
        data = decoded[len("data: "):]
        if data.strip() == "[DONE]":
            break
        chunk = json.loads(data)
        delta = chunk["choices"][0].get("delta", {})
        audio = delta.get("audio", {})
        if audio.get("data"):
            audio_data_chunks.append(audio["data"])
        if audio.get("transcript"):
            transcript_chunks.append(audio["transcript"])
    transcript = "".join(transcript_chunks)
    print(f"Transcript: {transcript}")
    # Combine and decode the base64 audio chunks, then save
    full_audio_b64 = "".join(audio_data_chunks)
    audio_bytes = base64.b64decode(full_audio_b64)
    with open("output.wav", "wb") as f:
        f.write(audio_bytes)
```

```
const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY_REF}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "{{MODEL}}",
        messages: [
          {
            role: "user",
            content: "Say hello in a friendly tone.",
          },
        ],
        modalities: ["text", "audio"],
        audio: {
          voice: "alloy",
          format: "wav",
        },
        stream: true,
      }),
    });
    // Audio output requires streaming — parse the SSE chunks
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const audioDataChunks: string[] = [];
    const transcriptChunks: string[] = [];
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!; // keep incomplete line in buffer
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice("data: ".length).trim();
        if (data === "[DONE]") break;
        const chunk = JSON.parse(data);
        const audio = chunk.choices?.[0]?.delta?.audio;
        if (audio?.data) audioDataChunks.push(audio.data);
        if (audio?.transcript) transcriptChunks.push(audio.transcript);
      }
    }
    const transcript = transcriptChunks.join("");
    console.log(`Transcript: ${transcript}`);
    // audioDataChunks joined together is the full base64-encoded audio
    const fullAudioB64 = audioDataChunks.join("");
```

```
{
  "choices": [
    {
      "delta": {
        "audio": {
          "data": "
",
          "transcript": "Hello"
        }
      }
    }
  ]
}
```

- Send audio files to compatible models for transcription, analysis, and processing. Audio input requests use the `/api/v1/chat/completions` API with the `input_audio` content type. Audio files must be base64-encoded and include the format specification.
- **Note**: Audio files must be **base64-encoded** - direct URLs are not supported for audio content.
- async function encodeAudioToBase64(audioPath: string): Promise
- return audioBuffer.toString("base64");
- const base64Audio = await encodeAudioToBase64(audioPath);
- def encode_audio_to_base64(audio_path):
- return base64.b64encode(audio_file.read()).decode('utf-8')
- base64_audio = encode_audio_to_base64(audio_path)
- "data": base64_audio,
- async function encodeAudioToBase64(audioPath: string): Promise
- return audioBuffer.toString("base64");
- const base64Audio = await encodeAudioToBase64(audioPath);
- Supported audio formats vary by provider. Common formats include:
- To receive audio output, set `modalities` to `["text", "audio"]` and provide the `audio` configuration with your desired voice and format:
- # Audio output requires streaming — the response is delivered as SSE chunks
- response = requests.post(url, headers=headers, json=payload, stream=True)
- # Combine and decode the base64 audio chunks, then save
- audio_bytes = base64.b64decode(full_audio_b64)
- // Audio output requires streaming — parse the SSE chunks
- buffer += decoder.decode(value, { stream: true });
- // audioDataChunks joined together is the full base64-encoded audio
- Audio output requires streaming (`stream: true`). Audio data and transcript are delivered incrementally via the `delta.audio` field in each chunk:
- | `voice` | The voice to use for audio generation (e.g., `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`). Available voices vary by model. |

## Model fallbacks

```
import { OpenRouter } from '@openrouter/sdk';
  const openRouter = new OpenRouter({
    apiKey: '
',
  });
  const completion = await openRouter.chat.send({
    chatRequest: {
      models: ['~anthropic/claude-sonnet-latest', 'gryphe/mythomax-l2-13b'],
      messages: [
        {
          role: 'user',
          content: 'What is the meaning of life?',
        },
      ],
    },
  });
  if (completion instanceof ReadableStream) {
    throw new Error('Expected a non-streaming response');
  }
  console.log(completion.choices[0].message.content);
```

```
const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer 
',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      models: ['~anthropic/claude-sonnet-latest', 'gryphe/mythomax-l2-13b'],
      messages: [
        {
          role: 'user',
          content: 'What is the meaning of life?',
        },
      ],
    }),
  });
  const data = await response.json();
  console.log(data.choices[0].message.content);
```

```
import requests
  import json
  response = requests.post(
    url="https://openrouter.ai/api/v1/chat/completions",
    headers={
      "Authorization": "Bearer 
",
      "Content-Type": "application/json",
    },
    data=json.dumps({
      "models": ["~anthropic/claude-sonnet-latest", "gryphe/mythomax-l2-13b"],
      "messages": [
        {
          "role": "user",
          "content": "What is the meaning of life?"
        }
      ]
    })
  )
  data = response.json()
  print(data['choices'][0]['message']['content'])
```

```
from openai import OpenAI
    openai_client = OpenAI(
      base_url="https://openrouter.ai/api/v1",
      api_key={{API_KEY_REF}},
    )
    completion = openai_client.chat.completions.create(
        model="~openai/gpt-sol-latest",
        extra_body={
            "models": ["~anthropic/claude-sonnet-latest", "gryphe/mythomax-l2-13b"],
        },
        messages=[
            {
                "role": "user",
                "content": "What is the meaning of life?"
            }
        ]
    )
    print(completion.choices[0].message.content)
```

```
import OpenAI from 'openai';
    const openrouterClient = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: '{{API_KEY_REF}}',
    });
    async function main() {
      // @ts-expect-error
      const completion = await openrouterClient.chat.completions.create({
        model: '~openai/gpt-sol-latest',
        models: ['~anthropic/claude-sonnet-latest', 'gryphe/mythomax-l2-13b'],
        messages: [
          {
            role: 'user',
            content: 'What is the meaning of life?',
          },
        ],
      });
      console.log(completion.choices[0].message);
    }
    main();
```

- The `models` parameter lets you automatically try other models if the primary model's providers are down, rate-limited, or refuse to reply due to content moderation.
- if (completion instanceof ReadableStream) {
- throw new Error('Expected a non-streaming response');
- If the model you selected returns an error, OpenRouter will try to use the fallback model instead. If the fallback model is down or returns an error, OpenRouter will return that error.
- By default, any error can trigger the use of a fallback model, including:
- The Anthropic Messages API endpoint (`/api/v1/messages`) accepts the `fallbacks` parameter, matching the shape used by Anthropic's SDKs. Each entry names a fallback model to try in order, and the list maps to OpenRouter's `models` routing, so fallbacks trigger on the same errors listed above (rate limits, downtime, moderation refusals), not only on refusals.
- OpenRouter handles this fallback routing itself. The `fallbacks` parameter does not use Anthropic's server-side fallback feature.
- fallbacks: [{ model: 'anthropic/claude-opus-4.1' }],
- * Each `fallbacks` entry accepts only the `model` field. Per-attempt overrides such as `max_tokens`, `thinking`, `speed`, or `output_config` are rejected with a 400 error.
- * `fallbacks` cannot be combined with the `models` parameter; sending both returns a 400 error.
- * `fallbacks` accepts at most 3 entries; longer lists return a 400 error.
- To use the `models` array with the OpenAI SDK, include it in the `extra_body` parameter. In the example below, `~openai/gpt-sol-latest` will be tried first, and the `models` array will be tried in order as fallbacks.
