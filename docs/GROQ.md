# Groq NPC conversation and planning

## Hybrid local vision + Groq

`NPC_LLM_PROVIDER=hybrid` uses the installed local Qwen model to describe game
screenshots. Groq receives only this short text observation and relevant engine
object data, never image pixels. Groq still handles dialogue and action planning.
The local caption is fallible evidence, not a source of executable coordinates:
the engine registry and crosshair raycast determine object identities and routes.

Ordinary conversation skips vision even if the screenshot checkbox is enabled.
Visual and pointing requests use local vision when an image is attached. Exact
identical frames can reuse a caption for 10 seconds; changed frames are processed
again. If local vision fails, its failure is explicit and no cloud image fallback
occurs. Cancellation propagates to both stages when a new request supersedes one.

The HUD shows local vision processing/time as well as Groq limits and API latency.
Local visual processing adds latency; its first request after startup is slower.
This trades local compute time for API token savings. In the recorded courtyard
probe, a visual turn used about 770–790 API tokens versus roughly 3,000 with cloud
vision (about 74% less). See `artifacts/hybrid-benchmark.json` for sample timings.

Use `NPC_LLM_PROVIDER=groq` for direct cloud vision again, or `local` for all-local
dialogue. Keep one game server running to avoid duplicate model memory use.

Set these in the ignored `.env.local` file and restart Vite:

```dotenv
NPC_LLM_PROVIDER=groq
GROQ_MODEL=qwen/qwen3.8-27b
GROQ_API_KEY=your-key
```

For the hybrid pipeline, replace `groq` above with `hybrid`. The real warm browser
check measured 2.01 seconds until text appeared and 2.83 seconds until local voice
was ready (`artifacts/hybrid-real-game.json`). Cold first-image checks took 8–10
seconds; identical cached views skipped local inference. API-only latency in the
usage readout excludes the separately displayed local vision time.

The key stays on the server. Groq receives conversation context, relevant world
objects, and screenshots when enabled. Speech synthesis and recognition remain
local. Set `NPC_LLM_PROVIDER=local` to return to the installed local LLM.

The game HUD and pause menu show provider/model, request and token allowances,
refill countdowns, last model latency, and server-session calls/tokens. Values
come from Groq response headers; no remote inference is needed to poll status.
Before the first request, unavailable limits say unknown. Counts are dated
snapshots shared with other apps in the organization. Expired countdowns do not
invent replenished counts; the next API response supplies a new snapshot.
Daily token allowances are not exposed by these headers and are not inferred.
Session counters reset on server restart; headers remain account-wide.

Background planning runs at most once every 45 seconds after an activity ends.
Explicit follow/come/stop commands are handled without using Groq requests.
Turn off the screenshot checkbox for text-only turns to conserve tokens.
429 errors show reported reset/retry information; there is no automatic retry
loop or automatic paid-provider fallback.

The shared world-aware prompt and action validation are also used for Groq.
Model output must reference registered targets and supported interactions.
Dialogue streams immediately, with local speech generated separately.

Local benchmark artifacts: `artifacts/groq-benchmark.json`. On this machine,
Qwen returned dialogue and screenshot replies in approximately 0.5–0.7 seconds
and a correct walk-to-bench + sit plan in approximately 0.43 seconds. These are
small samples, include network and generation, and exclude local TTS latency.

The real browser check (`artifacts/groq-real-game.json`) measured 0.94 seconds
until text appeared and 1.77 seconds until the local voice clip was ready,
including a fresh in-game screenshot. Validation: 55 unit/integration tests,
6 relevant browser tests, and the production build passed.
