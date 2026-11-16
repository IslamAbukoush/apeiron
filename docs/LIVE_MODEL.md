# NPC response routing and latency

Local Paradee speech is now the default; see [local voice setup](LOCAL_VOICE.md).
The Live path below is available when `NPC_VOICE_PROVIDER=gemini` is explicitly set.

Voice-off messages use `gemini-3.5-flash-lite` with minimal thinking for text
and vision. `GEMINI_TEXT_MODEL` overrides this choice. Voice-enabled messages
use `gemini-3.8-live` for native streamed speech.

Every message includes a fresh screenshot when screenshot sharing is enabled.
The Live request sends the screenshot and question in the same `clientContent`
turn, avoiding ordering races between realtime video and text input.

Conversation requests have no action tools. The model speaks directly; its
transcript becomes the final reply with an empty plan. Explicit commands retain
the validated `reply_to_player` tool with NON_BLOCKING behavior and SILENT tool
responses. The shared short prompt keeps visual questions independent of whether
the crosshair hits walkable ground.

The browser requests NDJSON. The server forwards transcription, PCM audio and
command plans immediately. Chat updates one message as the transcript arrives,
and Web Audio plays 24 kHz chunks with a small jitter buffer. Neither waits for
turn completion, and streamed voice does not make an extra TTS request.

A real screenshot conversation measured 8572 ms to first audio before removing
conversation tools and shortening instructions, and 1267 ms afterward. The new
turn finished at 9398 ms, after speech had already begun. These are individual
measurements; provider and network latency varies. Records are in
`artifacts/latency-before.json` and `artifacts/latency-after.json`.

Validation: 29 unit/integration tests, the chat and voice browser checks, and
production build passed. Tests cover image forwarding, tool-free conversation,
command tool handling, early transcript/audio delivery and one chat message
through final completion.

Credentials remain server-side. Each Live session is bounded to one turn and
40 seconds, closes on completion or HTTP disconnect, and has a 4 MB PCM ceiling.
History is bounded, there are no automatic retries, and provider limits apply.
`GEMINI_SESSION_LIMIT` optionally sets a local request cap.

References: [Live tools](https://ai.google.dev/gemini-api/docs/live-api/tools),
[Live capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities).
