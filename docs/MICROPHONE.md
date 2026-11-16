# Local hold-to-talk input

Speech recognition uses [NVIDIA Parakeet-TDT 0.6B v2](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2)
through its [Sherpa-ONNX INT8 export](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo-transducer-models.html).
This is the requested v2 model, quantized for local CPU inference. It recognizes
English. The existing Qwen LLM stays on the GPU and Paradee supplies voice output.

## Setup and use

```sh
npm run stt:setup
npm run dev
```

Setup creates an isolated `.local-stt/venv`, installs the pinned CPU runtime and
downloads the encoder, decoder, joiner and token files into `.local-stt/model`.
The export is pinned to commit `84b478d541cdbf0c296a7ab5f1e20a6f8f998114` and
verified against its published LFS/Git hashes. The model source is recorded in
`.local-stt/model-source.json`. Only installation needs internet.

- While exploring, **hold V**, speak, then **release V** to send.
  This keeps the mouse captured and does not open or focus the text input.
- Alternatively, press **T** to open chat, then **hold the Hold to talk button**
  with the mouse or touch and release it to send. Releasing outside the button
  also works through pointer capture.
- A keyboard-focused microphone button supports holding Space or Enter.
- Allow the browser's microphone permission prompt. If you released before
  granting permission, hold again to record your message.
- **Escape cancels** without sending audio. Returning to the game, changing
  worlds, resetting, losing window focus or closing the page stops recording.
- V typed into the text field remains ordinary text. The V shortcut works while
  exploring; use the button when already typing.

Recording is bounded to 30 seconds and sends automatically at that limit. The
recognized words appear as a normal player message and go through the existing
NPC conversation/command and screenshot pipeline. Text chat still works. Enable
**NPC voice replies** to hear the answer through local Paradee.

## Runtime behavior

Once permission is granted, entering/resuming the game prepares the microphone
and AudioWorklet ahead of the first hold. The same device and processor remain
ready between messages, avoiding repeated device/processor startup. The browser's
microphone indicator stays active while it is ready. Pausing, Escape, loss of
focus and page teardown close the device; resuming prepares it again. A first
permission prompt or newly selected device still needs initial setup.

Audio is captured only while holding: the audio thread discards every sample
outside the hold, without retaining a background buffer. Release flushes the
final partial batch before conversion to mono 16 kHz, 16-bit PCM WAV and local
transcription. NPC playback stops when recording begins to reduce feedback.

`POST /api/npc/transcribe` accepts at most 30 seconds / 1 MB of validated WAV.
The route checks the origin, format, sample rate, channel count and duration.
`GET /api/npc/transcribe/status` reports readiness and model details. A persistent
Python worker loads the recognizer once with two CPU threads. Empty/silent input
does not send a player message, and failed recognition remains visible in chat.
Stale browser responses are discarded after cancellation or newer input.

Microphone clips exist only in memory and are sent to the local server; runtime
does not save or upload them to a cloud service. The resulting text and optional
screenshot follow the configured LLM provider. The default Qwen setup is local;
explicitly choosing Gemini sends that text/screenshot to Google as usual.

## Validation

The model's 7.4-second reference WAV was transcribed in about 0.84 seconds on
this laptop. Silence returned an empty transcript. Timing varies with clip
length and CPU load.

Browser tests feed prerecorded speech through Chrome's microphone capture,
AudioWorklet, real local Parakeet, and the NPC. They verify no request before
release, transcription, the follow action, device reuse, cancellation and
visible permission-denied feedback. Additional regressions check pointer lock,
input focus, held-key repeats, no idle audio batches, and first held audio within
150 ms on an already prepared microphone. The audio-thread test verifies final
batch flushing and discard outside the hold. The synthetic `Follow me.` fixture was
generated with the installed Paradee stock voice. A physical microphone still
depends on the user's device selection and browser permission.
