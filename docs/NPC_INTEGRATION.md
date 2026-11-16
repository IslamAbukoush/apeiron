# Decision-driven caretaker

Implemented and validated on 2026-11-16 in the Apeiron courtyard.

## Try it

Run `npm run dev` from the project root and open the URL Vite prints
(normally http://127.0.0.1:5173). Enable **Use decision model for the caretaker**
in the menu, enter the courtyard, approach the caretaker, and press **E**.
Type a request or use the quick commands. Resume exploring to see movement.

Supported behaviors: patrol, inspect the waystone, tend the lantern, follow,
guide the player to the waystone, greet, and wait. The lantern also responds
to the player's own E interaction. The caretaker pauses with the game.

The key is loaded on the server from `AI-TEST/.env.local`, with optional root
`.env.local` and process-environment overrides. The Snake test remains independent.
Only compact game state and the latest request are sent to AnyRouter.

## Implementation

`server/decision.ts` validates incoming world state, sends two typed choice
questions to AnyRouter, and validates both returned choices. `vite.config.ts`
mounts the server endpoints in development and preview. The browser receives
an action and reply identifier; it never receives the API key.

`src/game/npc-contract.ts` defines the allowed actions and authored replies.
`src/game/npc.ts` executes the selected action, tracks visited landmarks and
the latest instruction, and manages cancellation and explicit local fallback.
`src/game/navigation.ts` plans on a half-metre ground grid with body clearance.
The moving NPC updates its collision box every simulation step and stops
before entering the player's space. Object interactions execute on arrival.

The Decisions API selects typed answers rather than generating chat text:
[AnyRouter reference](https://www.anyrouter.dev/docs/api-reference/systemone).
Free-text player input is interpreted into supported actions and reply choices.
The three existing introductory FAQ buttons retain their authored answers.

## Request limits

AI is opt-in. The default is five upstream attempts per running Vite server,
shared between tabs, with no retries. Automatic decisions wait 12 seconds
after the last reply; manual requests also respect the server's three-second
cooldown. The WAIT action does not keep polling. Failed upstream attempts
consume the local allowance, and errors visibly disable AI and enable local
behavior. This is a local development allowance, not the provider account's
quota. Set `ANYROUTER_NPC_LIMIT` (maximum 100) only when appropriate for the
account. Restart/config reload resets the local counter.

## Validation

- `npm test`: 12 tests passed, including obstacle routes, body clearance,
  moving collision bounds, one-time lantern toggling, following distance,
  stale-response rejection after reset, invalid-model fallback, HTTP state
  validation, server-side credentials, and request limits.
- `npm run build`: passed TypeScript checks and Vite production build.
  Vite retains its existing large Three.js bundle advisory.
- `npm run test:browser`: four Chrome tests passed. They cover player free-text
  reaching the model adapter and triggering following; walking to and toggling
  the lantern; pause; visible quota fallback; and the original playground flow.
  These browser tests stub the upstream decision response to avoid using quota.
- One real request through the running server returned HTTP 200:
  `vllm-sr/d3-ultra` chose `FOLLOW_PLAYER` / `FOLLOW` for “Please follow me around
  the courtyard.” Server-measured round-trip time: 3014 ms.
- Confirmed the configured API key is absent from generated browser assets.
- Screenshots were inspected for the lantern scene and conversation controls.

Ignored artifacts: `artifacts/npc-live-result.json`,
`artifacts/npc-lantern.png`, and `artifacts/npc-conversation.png`.

## Limits

This navigation supports the courtyard's flat ground and static obstacles.
It does not jump, climb slopes, or navigate arbitrary generated meshes.
State is in memory and resets on reload. The caretaker uses the existing
placeholder character and simple foot animation. Persisted memory,
unrestricted generated dialogue, and new character assets are future work.
A static upload of `dist/` supports local behavior; live decisions require
the Node middleware. The prototype is intended for localhost use.
