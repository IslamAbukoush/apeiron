# Local NPC conversation and vision

Default: **Qwen3.5-2B Q4_K_M**, served by the project's portable Ollama runtime
on `127.0.0.1:11435`. Dialogue, screenshots and action plans require no API key.
Paradee continues to generate speech on the CPU.

## Why this model

The machine has an RTX 2050 with 4 GB VRAM, a Ryzen 5 7535HS and 16 GB RAM.
The quantized [2B model](https://ollama.com/library/qwen3.5:2b-q4_K_M) includes
image input and is about 1.9 GB on disk. It offers a useful balance between
small size and instruction following, with space for runtime buffers and the
game. The [0.8B variant](https://ollama.com/library/qwen3.5:0.8b) is a smaller
alternative if memory pressure becomes a problem; it was not benchmarked here.
Larger models leave less GPU headroom for the game.

This setup uses a 4096-token context, one model/request slot, disabled thinking,
bounded history and short replies. Ollama reports all model memory on the GPU.
Prompt processing uses a 128-token batch to limit memory pressure on this GPU.
Flash Attention is explicitly enabled so the vision encoder fits within 4 GB.
Image interpretation and complicated instructions can still be wrong; this small
model is not a quality equivalent to a large hosted model. Game-side action
validation, collision checks and navigation remain authoritative.

## Setup and operation

On Windows, with Node 22+, Python and Git installed:

```sh
npm run llm:setup
npm run tts:setup
npm run dev
```

The LLM setup downloads Ollama v0.40.16 from its official GitHub release,
verifies its published SHA-256, extracts a private portable installation, and
pulls `qwen3.5:2b-q4_K_M`. It warms an actual reply to initialize CUDA. The first
driver compilation can take a few minutes; subsequent cached starts are faster.
The runtime and model are in ignored `.local-llm/`. Downloads require internet;
conversation afterward is local and the service disables Ollama cloud features.

Vite starts and warms the local service automatically. Keep **NPC conversation
and planning** enabled, and optionally enable **NPC voice replies**. Text streams
while being generated; finalized dialogue then goes to local speech. Commands
use constrained JSON plans. No automatic cloud fallback occurs on failure.

Ctrl+C stops the game and its owned local workers, including Ollama's GPU child
processes. Ollama services from unrelated installations are not managed. Models
remain loaded for ten minutes of inactivity, then unload to release memory;
the next request may take longer to load.

Optional root `.env.local` settings:

```dotenv
NPC_LOCAL_MODEL=qwen3.5:2b-q4_K_M
# Explicitly opt back into the Google conversation backend:
# NPC_LLM_PROVIDER=gemini
```

Changing `NPC_LOCAL_MODEL` requires pulling that model into this project's
Ollama store. Cloud speech, if desired independently, remains opt-in through
`NPC_VOICE_PROVIDER=gemini`. The separate **Use decision model** checkbox still
selects Google Decision 1; leave it off for fully local play. Local reflex
rules still react immediately before the LLM's plan.

## Validation on this machine

After first-time CUDA initialization:

| Request | First text/action | Full reply |
| --- | --- | --- |
| Who are you? (including model startup) | 4.28 s | 4.40 s |
| Follow me | 0.64 s | 0.64 s |
| What do you see here? (game screenshot) | 0.69 s | 0.98 s |
| What color are the trees? (same screenshot) | 0.35 s | 0.37 s |

The follow request selected FOLLOW_PLAYER; the visual replies identified the
path, structure, character and green trees. These are individual warm-cache
measurements, not guaranteed latency. Results and residency information are in
`artifacts/local-llm-verification.json` and `artifacts/local-llm-gpu.json`.

Integration tests verify image transport, early streamed text, separate TTS,
constrained action plans, invalid input/origin rejection, and visible local
failure without a cloud request. The real browser check exercises screenshot
conversation, Paradee playback and following in the rendered world.

Validation passed: 35 unit/integration tests, all 11 Chrome browser checks, and
the production build. Total observed GPU memory use was about 2.3 GB of 4 GB.

Runtime diagnostics: `.local-llm/ollama.log`. Missing runtime or model: rerun
`npm run llm:setup`. No provider quota applies to local inference.

Run one game server at a time on this 16 GB machine. Multiple Vite servers each
load their own CPU speech workers. The local LLM manager checks service health
before requests and can restart its runtime if a previous owning server exited.

References: [model card](https://huggingface.co/Qwen/Qwen3.5-2B),
[Ollama chat API](https://docs.ollama.com/api/chat),
[structured outputs](https://docs.ollama.com/capabilities/structured-outputs).
