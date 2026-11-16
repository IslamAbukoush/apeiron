# Apeiron — Project Brief and Agent Context

Last updated: 2026-11-11

## Purpose

Apeiron is a thesis project: a persistent 3D exploration game in which specialized AI models generate environments, NPCs, and lore. The priority is a playable experience supported by a functioning generation pipeline. The project also explores consistency between models, believable NPCs, and generation during play.

The game foundation must use **Three.js**. The team consists of two developers comfortable with JavaScript/TypeScript and full-stack development. There is no fixed deadline, no budget, and no existing implementation at the time of this brief.

This document records the planning conversation and implementation status. It distinguishes agreed requirements from proposed implementation choices. The user subsequently authorized implementation of the first-person playground; see the current status below.

## Player experience

The player begins in first person in a small space facing a god or similarly powerful entity. Through a free-text conversation, the entity asks who the player wants to be and what kind of life or world they want to experience. The exact narrative framing and questions are still open to refinement.

That conversation informs a new world: its setting, atmosphere, visual direction, player identity, and starting circumstances. The player then enters a starting area, explores, and interacts with NPCs. Further areas can be generated as the player discovers them.

The eventual ambition is for the world and its presentation to reflect the player's wishes. Storylines and quests tailored to each experience may be added later; they are not part of the initial scope.

The first complete demonstration should be:

> Create a world → converse with the entity → prepare a starting area → explore → interact with an NPC → leave the game → resume the same world.

## Agreed requirements

- Three.js for the 3D foundation, with TypeScript as the planned implementation language.
- First-person exploration and NPC interaction.
- Desktop browser as the initial target. A desktop release on Steam is a longer-term ambition, requiring further discussion.
- Connected areas with loading transitions are acceptable for the initial implementation.
- Players type freely in the opening conversation.
- Placeholder geometry, assets, and mock model outputs are acceptable and encouraged during engine development.
- Multiple independent worlds/save slots are the current working decision.
- Full persistence: generated content, newly discovered areas, and game state survive leaving and reopening the game.
- Generated content is restored from storage when revisited, rather than regenerated on each load.
- Build the playable foundation before selecting and integrating every model.

## AI ambition and current model status

The long-term ambition covers world layouts, meshes, textures, animations, NPC appearances, NPC decisions, dialogue and reasoning, voices, and lore.

The user has explored TTS models, "JEV-like" models for NPC decisions, small LLMs for dialogue/reasoning, text-to-image models, and image-to-3D models. No exact model names or providers have been confirmed. Do not silently interpret the term "JEV-like" as a particular architecture or product; clarify when it becomes relevant.

Models should be replaceable behind adapters. The team intends to investigate small models and potentially free online hosting. Free service availability, quotas, reliability, and model suitability have not been established. Do not assume permanent free GPU hosting or that all inference will run on the laptops.

## Hardware and practical constraints

- One developer has an HP Victus 15 laptop; the other has a Victus 16.
- Exact GPU models, VRAM, RAM, and operating systems have not been supplied. Laptop family names are insufficient to determine inference capacity.
- The development workspace shown during planning is on Windows with PowerShell; that does not establish both developers' operating systems.
- The team has no budget and wants to experiment before committing to models or services.
- No fixed thesis deadline or additional university requirements were supplied.

Missing hardware specifications do not block engine development. They matter before choosing local inference workloads.

## Proposed architecture

These are planning defaults, not implemented components or irrevocable technology choices.

### Game client

Three.js handles rendering. The application supplies the game loop, first-person controller, collision handling, lighting, asset loading, interactions, dialogue UI, audio, loading transitions, and pause/settings controls.

Keep the foundation focused on this game rather than attempting a general-purpose engine. Rendering objects must not be the authoritative save format.

### World state

Use serializable records with stable IDs for worlds, areas, entities, NPCs, lore, and assets. Separate generated definitions from mutable state, such as current positions, opened doors, conversations, and player progress.

Maintain a shared world specification derived from the opening conversation. Preserve both the original conversation and its structured interpretation. Established facts should be available to later generation steps to support consistency.

### Persistence

Provide independent world slots, autosave, asset storage, portable export/import, and versioned save formats. Save consistent snapshots and preserve the previous valid save if a write is interrupted.

Persistence should cover:

- World specification and opening conversation.
- Area layouts and connections.
- Generated assets and metadata.
- Player identity, position, current area, and progress.
- NPC identities, mutable state, relevant memories, and relationships.
- Established lore and relevant conversations.
- World changes caused by play.
- Generation jobs and their completed outputs, sufficient to recover or retry interrupted work.

Generated content should be validated and saved before it becomes part of the active world. Avoid savefiles that depend solely on expiring remote asset URLs.

Browser-local storage is the proposed prototype default, with portable save export/import including referenced generated assets. Browser storage can be cleared or lost; it cannot alone guarantee permanent retention. The exact storage technology, backup approach, quotas, and eventual desktop storage implementation remain undecided.

### Generation backend

Use a separate service for asynchronous generation jobs and model integrations. It should be runnable locally during development. Model credentials and heavyweight inference belong outside the browser client.

Track job progress, dependencies, failures, retries, cancellation, and cached outputs. The client should remain responsive while jobs run. Provide understandable loading states and recoverable failures.

A conceptual pipeline is:

```text
Opening conversation
    ↓
World specification and established lore
    ↓
Area layout and character descriptions
    ↓
Images, meshes, textures, animations, voices
    ↓
Validation and asset preparation
    ↓
Persisted, playable area
```

This is a dependency sketch, not a requirement that every stage execute serially or that every asset type be generated before any gameplay begins.

### Model adapters

Define replaceable contracts for world planning, dialogue, NPC decisions, images, meshes, animation, and speech as needed. Initially use deterministic sample outputs, placeholder assets, and simulated delays/failures.

Models produce structured data and assets that the game validates and interprets. Generated content should not need to execute arbitrary code.

### Area lifecycle

Use small connected areas initially: a clearing, street, house, or room. Give each area a stable identity and explicit loading, activation, saving, and unloading behavior.

Entering a known destination loads saved content. Entering an unknown destination may trigger generation. Dispose of unused graphics resources and manage memory as areas change. Seamless world streaming is a possible later extension, not an initial requirement.

### NPC behavior

Keep basic movement, collision, navigation, and interaction independent of model availability. Begin with simple supported actions such as move, face a target, speak, wait, and interact.

A model may propose an intention or action; the game checks whether it is valid and executes it through supported behaviors. Dialogue text is not itself authoritative world state.

Use simplified gameplay geometry for collisions and navigation so generated visual assets do not determine reliability.

### Asset preparation and performance

Generated meshes require validation and preparation: scale, orientation, collision representation, and potentially rigging/animation compatibility. A successful generation response is not necessarily a usable game asset.

Player-selected visual direction must operate within technical limits for geometry complexity, texture resolution, asset size, and active NPC count. Exact limits should follow measurements on target hardware.

### Browser and eventual desktop release

Keep gameplay independent of browser-specific persistence and model hosting. Use replaceable interfaces for storage, filesystem access, and inference connections.

Desktop packaging and Steam distribution should be evaluated after a playable prototype exists. No desktop wrapper, distribution workflow, or Steam integration has been selected.

## Initial scope

- Single-player desktop browser experience with keyboard and mouse.
- Small placeholder areas connected by explicit transitions.
- One first-person controller and basic interaction system.
- Free-text opening conversation and NPC dialogue interfaces.
- Mock generation adapters before real model integrations.
- Persistent world slots, autosave, and save export/import.
- Basic debug and performance inspection tools.

Defer combat, crafting, complex quests, multiplayer, voice input, elaborate NPC simulation, and seamless open-world streaming until they support a demonstrated need. Do not treat deferred features as permanently rejected.

## Development milestones and acceptance criteria

### 1. First-person playground

Create a small placeholder environment with mouse look, movement, gravity, collisions, interaction targeting, pause controls, and basic performance diagnostics.

**Acceptance:** the player can comfortably explore and interact with a placeholder NPC.

### 2. Persistent worlds

Introduce world slots, stable IDs, serializable state, versioned saves, autosave, and export/import. Preserve player position, current area, entities, and changes.

**Acceptance:** restarting or importing a save restores the same world and player state, including referenced assets. Interrupted saving does not destroy the prior valid save.

### 3. Opening conversation

Create the entity's starting space and free-text conversation UI. Use a mock adapter to produce a structured world specification. The starting space can host the player while generation runs.

**Acceptance:** completing the conversation persists its result and starts a tracked generation job.

### 4. Complete mock pipeline and area transitions

Generate a sample starting area with terrain, objects, an NPC, and lore. Validate and persist it before entry. Add exits to further areas and simulate delays, failures, retries, and quitting during generation.

**Acceptance:** the player can discover a second area, revisit the first, and resume after restarting without losing completed content.

### 5. NPC foundations

Add basic NPC movement, dialogue history, persistent state, and a small validated action vocabulary.

**Acceptance:** an NPC can move, converse, and retain relevant state across visits.

### 6. Real model experiments

Replace mocks incrementally. Text-based world planning and dialogue are proposed first integrations, followed by speech and visual asset generation. Actual sequencing depends on available models and hardware.

Provide a small testing interface for inspecting model inputs, outputs, latency, and failures without replaying the whole game.

**Acceptance:** individual adapters can be swapped and evaluated while the core playable loop and persistence remain reliable.

## Evaluation and thesis evidence

Instrument the prototype to collect evidence about:

- Time until the starting area is playable.
- Generation latency, failure rate, and recovery behavior.
- Frame performance and memory use.
- Save restoration correctness.
- Consistency of generated content with established world facts.
- Whether players feel the experience reflects their opening choices.

Record relevant generation inputs, outputs, and model/configuration metadata to make experiments inspectable and replayable. Replaying saved outputs is distinct from assuming that a model will regenerate identical results.

## Suggested team split

A possible split is client/gameplay for one developer and backend/persistence/pipeline for the other. Agree on shared data contracts together before substantial independent implementation. This split has not been assigned to specific people.

## Open decisions

- Exact laptop specifications and realistic local inference capacity.
- Concrete model names, licenses, providers, hosting, and resource requirements.
- Collision/physics and navigation libraries.
- Backend framework, transport, and job execution approach.
- Browser storage technology and practical asset/save size limits.
- Supported browser baseline and performance targets.
- Details of the entity's conversation and how world preferences become a structured specification.
- Initial area size, generation wait-time expectations, and fallback behavior.
- Scope of NPC memory and lore consistency mechanisms.
- Desktop packaging and Steam release strategy.

## Instructions and context for future agents

1. Read this brief before proposing architecture or implementing features. Preserve the distinction between agreed requirements, proposed defaults, and open decisions.
2. The user subsequently authorized implementation of the first-person playground. Milestone 1 is now implemented. Do not interpret this as authorization to implement every later milestone automatically.
3. Read README.md for setup, module responsibilities, testing, and current limitations. World/save formats and generation adapter contracts still need detailed specification before those milestones.
4. Prioritize a complete playable loop and reliable persistence over breadth of generated features. Avoid adding unrequested systems or committing the project to paid services.
5. Do not repeatedly ask questions already answered here. Missing GPU/RAM information matters for inference selection, not for beginning engine work once authorized.
6. Do not present model choices, library choices, benchmarks, or hosting availability as verified unless they have actually been investigated.
7. Keep this document current when the user changes scope or approves major architectural decisions.
8. Follow applicable repository and session instructions. The user supplied CodeGraph guidance: use CodeGraph for structural code questions, symbol lookup, call relationships, impact, and focused code context; use native text search for literal text. Trust indexed results and avoid redundant verification or delegated exploration. For architecture questions, prefer context followed by one grouped source exploration; for flow questions, prefer trace followed by grouped source exploration.
9. The user explicitly approved CodeGraph initialization during playground implementation. `codegraph init -i` and indexing were performed. If the MCP server cannot locate the index, pass the absolute workspace path as `projectPath`. Index data is ignored by Git; another checkout may require initialization.

## Current implementation status

Milestone 1 is implemented using TypeScript, Three.js, and Vite: a placeholder courtyard, first-person mouse/keyboard controls, gravity, jumping, static box collisions, interaction targeting, scripted caretaker dialogue, an inspectable waystone, pause/settings controls, and diagnostics. Physics runs at a fixed 120 Hz with capped catch-up time.

The client has separate world construction, player physics, interaction, UI, and lifecycle modules. Unit tests cover physics and interaction; a Playwright browser test covers the playable loop. See README.md for commands.

The user subsequently authorized automatic map generation from a free-text world description, with “Candy world” as the concrete example. The client now includes an opening world-description form and local deterministic procedural generation. Six supported themes (candy, forest, desert, frozen, volcanic and cosmic) change geometry, palettes, landmarks and lighting. Supported modifiers include color, nighttime and density. Unrecognized descriptions explicitly fall back to a forest. This keyword planner is not an AI model and does not interpret arbitrary details or negation.

`generation.ts` defines a versioned, serializable map record containing the prompt, seed, palette and stable prop records; `generated-world.ts` renders it with built-in geometry and simple collision proxies. The same description and seed reproduce the same record for the same generator version. The pause menu supports creating a replacement map and disposes the old scene. The caretaker and waystone describe the current map. The original playground remains accessible for engine regression checks.

There is still no persistence, generation backend, model integration, multi-turn opening conversation, NPC navigation, or area streaming. Generated maps reset on reload. This implements an initial local generation slice, not every later milestone. The caretaker's response buttons remain temporary scripted dialogue, not a change to the free-text conversation requirement. Static AABB collisions remain a prototype for flat maps, not arbitrary generated terrain or meshes.
