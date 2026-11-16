# Local NPC speech

Paradee 1.3.1 is the default speech engine. Qwen3.5-2B supplies dialogue,
vision and plans locally on the GPU; speech is a separate local step.
It cannot delay the display or execution of the model reply.

## Model choice

| Model | Fit for this game |
| --- | --- |
| [Paradee](https://github.com/sahilmahendrakar/paradee) | Small CPU ONNX model, eight stock voices in four languages. Chosen for responsive NPC dialogue without competing for GPU memory. No voice cloning. |
| [Audio8 Realistic Air](https://github.com/Edge0-AI/Audio8_TTS) | The upstream successor name for Audio8-TTS-Realistic-0.6b. Larger 0.6B model, 23 languages and reference voice cloning; CUDA recommended, with no current Realistic Air ONNX export. More suitable if cloning or broader language coverage outweighs the extra runtime load. |

The laptop has 16 GB RAM and a 4 GB RTX 2050. The choice prioritizes response
time and leaves GPU memory to the game. Audio8 was researched, not installed or
benchmarked here; no head-to-head listening quality claim is made.

## Setup and use

Install Python 3.10+ and Git, then run from the project root:

```sh
npm run tts:setup
npm run dev
```

Enable **NPC voice replies**. Chat remains usable if speech fails or is muted.
The worker starts automatically with Vite, stays loaded, and is terminated when
the server closes. Ctrl+C stops the game server and its speech worker.

The isolated environment, model cache and pronunciation data are under ignored
`.local-tts/`. Installation needs internet; runtime sets `HF_HUB_OFFLINE=1` and
uses the cached model. No TTS key, cloud speech request or GPU is required.
Local speech itself has no per-day request quota. The default local conversation model also needs no cloud quota; explicit
Google provider choices still use their account allowance.

Set `PARADEE_VOICE` in the root `.env.local` to select a voice, then restart Vite:

- `am_puck`: default American male.
- `af_heart`: American female.
- `bm_fable`: British male.
- `bf_isabella`: British female.

To opt back into Google native speech, set `NPC_VOICE_PROVIDER=gemini`.
`GEMINI_MODEL` selects its Live model. The previous separate Google TTS endpoint
is retained only for this explicitly selected provider. There is no automatic
fallback from local speech to cloud speech.

## Implementation and verification

`server/local_tts.py` loads Paradee once and accepts JSON lines over stdin.
`server/local-tts.ts` manages the worker, request IDs, startup and inference
deadlines, bounded pending requests and shutdown. `/api/npc/tts` validates input
and returns 24 kHz mono WAV; `/api/npc/tts/status` reports provider and readiness.
The endpoint retains same-origin protection. The browser stops stale playback
when voice is muted or a newer request is submitted.

Observed warm synthesis: 212 ms for a 4.75-second line and 139 ms for a
2.9-second line. The first request during startup waited about five seconds for
initial worker loading; later requests reuse the same model. These timings
exclude Gemini inference. Samples are in `artifacts/paradee-0.wav` and
`artifacts/paradee-1.wav`, with timings in `artifacts/local-tts-verification.json`.

31 unit/integration tests, all 10 Chrome browser checks and the production build
passed. The local voice browser check uses actual Paradee audio and confirms
that text appears before speech completes, WAV decoding succeeds and playback
starts. Adapter tests ensure voice-enabled requests use the text/vision model,
and local speech needs no Google key or cloud fallback.
