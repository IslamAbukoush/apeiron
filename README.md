# Apeiron

A Three.js first-person playground for the persistent AI-generated exploration game described in [PROJECT_BRIEF.md](PROJECT_BRIEF.md).

## Run locally

Use Node.js 22.12+ (tested with 22.15) and npm. From this directory:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite, normally http://127.0.0.1:5173. Click **Enter playground** to capture the mouse. A desktop browser with WebGL 2 and a keyboard/mouse is required. Local NPC behavior needs no keys or downloaded assets. The optional decision model uses the AnyRouter setup in `AI-TEST`.

## Chat, vision, and Google voice

Press **T** anywhere in the courtyard to type in the persistent caretaker chat.
You do not need to approach the NPC. **E** interaction still works as before.
Chat history remains visible while exploring; sending restores movement. While
typing, your movement/look input is suspended but the NPC simulation continues.
Escape or **Return to game** leaves typing mode.

Aim the crosshair first, then press T. With **Include game screenshot and pointed
target** checked, the game captures a 640-pixel-wide JPEG of the rendered scene
at that moment, marks the center crosshair, and sends it to Gemini along with
the raycast hit coordinates and target label. Only the game canvas is captured,
not other windows or desktop content. Uncheck the option for text-only messages.

Try **What is this?** while pointing at an object, or **Stand there** while pointing
at open ground. The latter uses the actual hit coordinates rather than asking the
model to guess a location from pixels. Navigation checks ground clearance and
reachability; it rejects sky, raised surfaces, walls, and occupied spots. The NPC
stays at the reached destination. Object tops and jumping onto platforms are not
supported. Vision is per-message, not continuous surveillance or autonomous sight.

Enable **Google AI voice replies** in the pause menu for server-generated speech.
The default model is `gemini-2.5-flash-preview-tts`, voice Kore, with optional
`GEMINI_TTS_MODEL` override. Google returns PCM, which the server wraps in WAV.
The audio player appears in chat; if the browser blocks autoplay, press play.
Errors remain visible and text replies continue working. Turning voice off or
sending a new message stops old playback. Keys stay on the local server.

## Decision-driven caretaker

### Hybrid conversation and responsive controls

Enable **Gemini conversation and planning** to get generated dialogue and a
short sequence of actions. Enable **Use decision model for the caretaker**
for AnyRouter's faster action choices. Both can run together: the caretaker
reacts locally immediately, then accepts the decision-model result, and Gemini's
deliberate plan takes priority once ready. A late fast result cannot overwrite it.
Try “Introduce yourself, then show me the waystone and tend the lantern.”
Jump/hop requests produce a short visual hop; movement safety remains local.

Requests resume play immediately. Replies appear as subtitles while you move;
the world no longer waits in conversation mode for the network. Cached static
navigation connectivity reduces repeated route-search work. New commands and
reset invalidate stale responses. Escape still pauses normally.

Google credentials use `GEMINI_API_KEY` in the ignored root `.env.local`.
`GEMINI_MODEL` defaults to `gemini-2.5-flash`. Gemini keeps the last four
conversation exchanges in memory and can plan up to three supported actions.
There is a separate 20-attempt Gemini allowance per server session and a
25-second upstream timeout. No retries are made. Failed Gemini requests leave
the current action running and report the error in the HUD. This local cap is
not a provider billing limit. Optional **Google AI voice replies** generates speech
through Google on the server and plays the returned WAV in the browser. Voice
has its own 20-attempt session cap. If autoplay is blocked, use the audio player.

The caretaker walks around obstacles, inspects the waystone, tends a working lantern,
follows the player, guides them to the waystone, and waits on request. Approach and
press **E** to use quick commands or type a request. Choose **Back to exploring**
to return from inspection. Walking and automatic model requests stop while paused (an already
in-flight request can finish); dialogue requests can still be submitted.

To use `AI-TEST`'s `vllm-sr/d3-ultra` model, enable **Use decision model for the
caretaker** in the start/pause menu. The local Node/Vite middleware automatically
reads `ANYROUTER_API_KEY` from `AI-TEST/.env.local`, or a root `.env.local` override.
Keys never go into the browser bundle. No separate Snake server is required;
`AI-TEST` remains unchanged and can still run independently.

The model receives courtyard positions, the current task, visited landmarks,
lantern state and the latest player request. It selects an allowed action and an
authored reply using the same typed Decisions API as the Snake demo. Gemini
adds generated dialogue and a longer action plan when its checkbox is enabled.
The game handles navigation and executes interactions only on arrival.

By default, AI is off and there are **five upstream attempts per Vite server
session**, shared across tabs. Automatic decisions are spaced at least 12 seconds
after the last response. Failed calls count toward the cap; there are no automatic
retries. Timeouts, quota errors and invalid answers visibly switch to local
behavior. Switching the checkbox back on does not replenish the server allowance.
Restarting Vite/config hot reload resets the local cap, not the provider's quota.
Only raise `ANYROUTER_NPC_LIMIT` in `.env.local` if your account supports more
requests; `ANYROUTER_MODEL` optionally overrides the model ID.

The HUD identifies local/model/fallback behavior and reports model latency. **Return
to spawn** resets the player and caretaker (including pending requests), but keeps
the server's API allowance and the lantern's state. The model remembers the last
player request and visited landmarks only until reload/reset.

`npm run preview` also includes the decision endpoint. A static upload of `dist/`
alone supports local behavior only; live AI requires this Node backend. Keep the
server bound to localhost: this prototype has no public-server authentication.

See [NPC integration notes and test results](docs/NPC_INTEGRATION.md).

## World generation

Try **Candy world**: the map has pink ground, cream paths, lollipops, gumdrops, cotton-candy trees and a giant cupcake landmark. Other themes are forest, desert, frozen, volcanic and cosmic, each with distinct geometry and lighting. The planner chooses the theme with the most matching keywords; ties use the listed theme order (candy first). Unrecognized descriptions explicitly fall back to a forest.

Descriptions also support a color (pink, purple, blue, green, red, orange or yellow), nighttime keywords, and sparse/lush density. These are keyword rules, not general language understanding: unsupported details and negations are not interpreted. World generation itself uses local rules. This is a procedural foundation for a future model-backed planner, not unrestricted text-to-3D generation.

An optional seed recreates the same layout with the same description and generator version. Leaving it blank picks a fresh seed, shown in the result and at the waystone. Maps contain clear crossing paths, a safe spawn, simple collision proxies, a caretaker and a themed landmark. Create another world from the pause menu; replacing a map releases its graphics resources. Worlds and player progress are **not saved** on reload.

## Controls

| Input | Action |
| --- | --- |
| W / A / S / D | Move |
| Mouse | Look |
| Shift | Run |
| Space | Jump |
| T | Open caretaker chat from anywhere |
| E | Talk to or inspect the object under the crosshair, within 3 metres |
| Escape | Release mouse and pause; close dialogue to the pause menu |
| F3 | Toggle frame rate, frame time, draw calls, triangles, position, and collision diagnostics |

The caretaker is straight ahead of spawn. A waystone stands beside the path to the right. Stone platforms and crates provide collision/jump test surfaces. Settings expose mouse sensitivity, rendering quality, collision bounds, and return-to-spawn. Low quality disables shadows; medium/high cap pixel ratio at 1.5/2. Losing focus pauses movement.

## Verify

```sh
npm test
npm run build
npm run test:browser
```

The browser test uses installed Google Chrome through Playwright and starts/stops its own Vite server on port 5174. If Chrome is missing, install it or change the Playwright channel to an installed browser. Test screenshots are written to ignored `artifacts/`; failure output goes to ignored `test-results/`.

Unit tests cover physics, interaction, generation determinism, prompt validation, theme selection and map/spawn collision safety across themes and seeds. Browser tests cover the original playable loop plus world creation, themed dialogue, map replacement, settings, fallback feedback and reload behavior. They check for uncaught runtime errors and explicitly release pointer lock to exercise pause; manually verify physical Escape and mouse feel on the target laptops.

The production build goes to `dist/`. `npm run preview` serves that build locally. The initial bundle includes Three.js and may trigger Vite's 500 kB chunk-size advisory; this is not a build failure.

## Code layout

| File | Responsibility |
| --- | --- |
| `src/main.ts` | Entry point and hot-reload teardown |
| `src/game/game.ts` | Renderer, fixed-step loop, input/pointer lock, pause, settings, dialogue coordination, cleanup |
| `src/game/physics.ts` | Player body state, gravity, jumping, collision resolution, spawn reset |
| `src/game/world.ts` | Deterministic placeholder scene, static colliders, interaction metadata, resource disposal |
| `src/game/generation.ts` | Serializable map definitions and deterministic local prompt/seed planner |
| `src/game/generated-world.ts` | Theme-specific procedural meshes, map collision proxies and lighting |
| `src/game/interaction.ts` | Centre-screen raycast with range and occlusion checks |
| `src/ui/interface.ts` | Accessible native dialogs, HUD and settings markup |
| `src/style.css` | Menu/HUD styling |

Physics uses metres, a Y-up coordinate system, and a feet-position player state separate from the camera. Simulation steps are 1/120 second; frame catch-up is capped at 100 ms. Movement uses axis-separated AABB collision resolution with normalized diagonal input. Jumping is required to get onto raised obstacles; there is no automatic stair stepping or slope handling.

## Scope and limitations

Geometry is handmade placeholder content, not the generation pipeline. NPC navigation, optional decision-model calls, Gemini conversation/plans and browser voice are implemented. There are no savefiles, world slots, quests, recorded character voices, or area transitions yet. Reloading resets the playground.

The first-person foundation and local procedural world generation are implemented. Geometry is made from built-in primitives; NPC replies are scripted and reflect the current map. There are no model calls, savefiles, world slots, multi-turn opening conversations, NPC pathfinding, quests, audio, or area transitions yet. Reloading returns to world creation. The free-text world prompt is a first step toward the planned opening conversation.

The simple colliders and ground-plane grid navigation support this courtyard, not arbitrary generated meshes, slopes, or complex terrain. The caretaker's collision box moves with it, but it does not push the player or jump onto platforms. Collision representation and navigation must be revisited before importing generated environments. Assets, dialogue, and settings are not persisted. Performance must still be measured on both target laptops; automated browser timing is not a hardware benchmark.

CodeGraph was initialized with user approval. Run `codegraph index` to rebuild the local index when needed; `.codegraph/` is not committed. Prefer CodeGraph for structural exploration as described in the project brief.

Reference documentation: [Three.js](https://threejs.org/docs/) and [Vite](https://vite.dev/guide/).
