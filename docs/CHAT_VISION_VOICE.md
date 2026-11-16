# Chat, visual context, and Google TTS — 2026-11-16

Press T after aiming to chat from anywhere. E interaction remains supported.
The message history is capped at 60 displayed entries; Gemini receives the last
eight conversation turns. The screenshot and target are frozen at chat entry,
so typing does not change what “this” refers to. Close chat and aim again to
select something else. The include-view checkbox controls transmission.

The screenshot contains the rendered game canvas only, resized to 640px width
with a red center marker. JPEG payloads are capped and validated server-side.
Ground movement uses a raycast and the navigation grid; screenshot interpretation
alone does not invent destinations. MOVE_TO_TARGET stops at arrival. Invalid or
unreachable targets leave the caretaker waiting with an activity message.

Voice uses Google's gemini-2.5-flash-preview-tts with Kore through the same
server-side key. PCM is converted to mono 16-bit WAV with the provider sample
rate. Text remains available if voice fails, and audio controls allow playback
after browser autoplay denial. A new reply cancels stale voice requests/playback.
There are 20 Google TTS attempts per server session, separately from Gemini chat.

Validation:

- 22 unit tests passed, including view/coordinate validation, WAV headers,
  pointed-target movement, staying on arrival, and rejecting raised targets.
- Eight Chrome tests passed, including remote chat without E interaction,
  screenshot/target payloads, text-only messages, and preserved scrollback.
- Production TypeScript/Vite build passed.
- Real Google TTS returned HTTP 200 and a 240,570-byte WAV.
- A real game screenshot was sent to Gemini. HTTP 200 in 1506 ms; it identified
  the caretaker at the crosshair and returned no unsolicited movement plan.
- The real screenshot/chat result was visually inspected.

Ignored validation artifacts: artifacts/google-voice.wav,
artifacts/vision-capture.jpg, artifacts/vision-live-result.json,
artifacts/vision-live-chat.png, and artifacts/npc-chat.png.

References: [Google image understanding](https://ai.google.dev/gemini-api/docs/generate-content/image-understanding),
[Google speech generation](https://ai.google.dev/gemini-api/docs/generate-content/speech-generation).

This is player-shared visual context, not the NPC's independent camera.
Navigation is limited to the courtyard's flat ground and does not climb object
tops. No microphone input, continuous camera streaming, or background audio
generation is enabled.

A concurrent procedural-world merge was reconciled. World replacement recreates
the caretaker controller and cancels old speech/model work; generated worlds
include the moving NPC collider and functional lantern. Generation and map
replacement browser tests pass alongside the chat tests.
