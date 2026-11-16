# Hybrid NPC update — 2026-11-16

Conversation follow-up: spoken answers now persist independently of task/activity
updates. Questions pause the caretaker's errands and route only to conversation;
explicit action requests can start a plan. Gemini is instructed to answer the
question directly, and unsolicited plans for ordinary questions are discarded on
both server and client. Background decisions no longer replay the last request.
The existing quick-question buttons use Gemini when enabled. Failed conversation
calls display an explicit failure rather than a generic welcome.

Google AI Studio is connected through a server-only `.env.local` credential.
No Gemini SDK or browser-side key is required. Gemini uses the documented
[structured generation API](https://ai.google.dev/api/generate-content) to
return speech and up to three validated action identifiers.

The game remains responsive during both remote calls. Submitting a request
restores mouse capture immediately, applies an immediate local reaction, and
starts the two remote requests independently. The fast action result can update
behavior until a Gemini plan arrives. Gemini then owns the plan, preventing a
late fast response from undoing it. Navigation/movement never waits on either
provider. Static navigation edges are cached instead of recomputed per search.

This is a simulated fast/slow controller, not consciousness. Neither remote
model offers a frame-time latency guarantee. Immediate movement safety and
collision avoidance stay in the game. JUMP is an in-place visual hop, not a
general jumping/pathfinding system. Voice is optional browser speech synthesis.

Validation:

- Real Google key validation via the models endpoint returned HTTP 200.
- Real Gemini conversation/planning call returned HTTP 200 in 1321 ms and
  generated an introduction plus GREET_PLAYER, GUIDE_PLAYER, TEND_LANTERN.
- Five Chrome tests passed, including a deliberately delayed Gemini response
  while the HUD remains active and player controls continue working.
- Unit coverage includes rejecting invalid plans, plan-vs-fast-response races,
  and ignoring late Gemini responses after reset.
- Model requests are stubbed in browser tests to preserve account quota.

See `artifacts/gemini-live-result.json` for the real call result (ignored by Git).
Original integration notes in NPC_INTEGRATION.md describe the earlier decision-only
version; the README's hybrid section describes current usage.
