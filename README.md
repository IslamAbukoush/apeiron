# Apeiron

A Three.js first-person playground for the persistent AI-generated exploration game described in [PROJECT_BRIEF.md](PROJECT_BRIEF.md).

## Run locally

Use Node.js 22.12+ (tested with 22.15) and npm. From this directory:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite, normally http://127.0.0.1:5173. Describe a world, click **Generate world**, then **Enter world** to capture the mouse. **Enter original playground** opens the original courtyard. A desktop browser with WebGL 2 and a keyboard/mouse is required. Everything runs locally; no keys, services, or downloaded game assets are needed.

## World generation

Try **Candy world**: the map has pink ground, cream paths, lollipops, gumdrops, cotton-candy trees and a giant cupcake landmark. Other themes are forest, desert, frozen, volcanic and cosmic, each with distinct geometry and lighting. The planner chooses the theme with the most matching keywords; ties use the listed theme order (candy first). Unrecognized descriptions explicitly fall back to a forest.

Descriptions also support a color (pink, purple, blue, green, red, orange or yellow), nighttime keywords, and sparse/lush density. These are keyword rules, not general language understanding: unsupported details and negations are not interpreted. No AI model is connected. This is a procedural foundation for a future model-backed planner, not unrestricted text-to-3D generation.

An optional seed recreates the same layout with the same description and generator version. Leaving it blank picks a fresh seed, shown in the result and at the waystone. Maps contain clear crossing paths, a safe spawn, simple collision proxies, a caretaker and a themed landmark. Create another world from the pause menu; replacing a map releases its graphics resources. Worlds and player progress are **not saved** on reload.

## Controls

| Input | Action |
| --- | --- |
| W / A / S / D | Move |
| Mouse | Look |
| Shift | Run |
| Space | Jump |
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

The first-person foundation and local procedural world generation are implemented. Geometry is made from built-in primitives; NPC replies are scripted and reflect the current map. There are no model calls, savefiles, world slots, multi-turn opening conversations, NPC pathfinding, quests, audio, or area transitions yet. Reloading returns to world creation. The free-text world prompt is a first step toward the planned opening conversation.

The simple static colliders support this courtyard, not arbitrary generated meshes, slopes, moving bodies, or complex terrain. Collision representation and navigation must be revisited before importing generated environments. Assets, dialogue, and settings are not persisted. Performance must still be measured on both target laptops; automated browser timing is not a hardware benchmark.

CodeGraph was initialized with user approval. Run `codegraph index` to rebuild the local index when needed; `.codegraph/` is not committed. Prefer CodeGraph for structural exploration as described in the project brief.

Reference documentation: [Three.js](https://threejs.org/docs/) and [Vite](https://vite.dev/guide/).
