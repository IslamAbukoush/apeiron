# World-aware caretaker

The courtyard and all six generated themes now supply the same `WorldRegistry`.
NPC behavior uses current registered objects and their bounds. The local LLM
receives the active world and a bounded catalog of relevant objects.

## Try it

- `Show me where is the bench` — guide to the bench, waiting for the player.
- `Go to the big cup cake` — approach the candy world's giant cupcake.
- `Inspect the frost spire` — visit and describe the frozen landmark.
- `Read the waystone` — read the current world's inscription and seed.
- `Turn on the lantern` / `Turn off the lantern` — approach, then change its
  state. Repeating the requested state does not flip it back.
- `Sit on the bench` — approach and use the primitive character's sitting pose.
  A subsequent movement request restores the standing pose at a clear position.
- `Go to the nearest pink lollipop` — resolve name, color and proximity.
- `Inspect that tree` — use the crosshair's object ID to disambiguate.
- `Stand there` — use the crosshair ground position, or approach a registered
  object when the crosshair identifies one.

Guide requests wait when the player is more than seven units away. Follow the
caretaker to continue; use `Go to ...` when you want it to travel independently.
For a sequence of tasks, separate them with `then` so the LLM can plan the steps.
Ordinary questions do not start tasks. A missing, ambiguous, unsupported or
unreachable target produces feedback rather than an unrelated trip to the stone.

## Object knowledge

Every registered object supplies a world-scoped ID, display name, aliases, kind,
color, description, current position, horizontal bounds, supported interactions
and current state. Meshes carry their object ID for raycast identity. Registry
descriptions are also used for E inspection; trees and crates no longer display
the waystone's inscription.

Registered objects include the original courtyard's arch, garden platform,
crates, platforms, trees, waystone and lantern. Generated maps register their
props, themed main landmark, platforms, lantern and waystone. A wooden bench is
added to every world, with a registered seat and supported sit interaction.

To add an object, register its mesh and metadata in the world's constructor.
Provide a handler only for real supported actions. Generic approach and inspect
work without adding a special branch to the caretaker. Snapshot positions come
from the live mesh transform. Collision footprints can augment visual bounds
when a conservative physics proxy is larger than the visible geometry.

## Planning and execution

Plans accept the existing immediate actions and generic object steps:

```json
[
  {"action":"GUIDE_TO_OBJECT","targetId":"landmark"},
  {"action":"INTERACT_OBJECT","targetId":"lantern","interaction":"toggle","state":"on"}
]
```

Other object actions are `GO_TO_OBJECT` and `INSPECT_OBJECT`; supported
interactions are `read`, `toggle` and `sit`. Both the local adapter and client
validate target IDs and capabilities. The local model's structured schema only
offers IDs from the supplied catalog. Straightforward named/pointed requests
resolve locally and start immediately; the model supplies dialogue. Unfamiliar
wording and multi-step requests can use model-selected object steps.

The model sees up to twelve relevant objects, including matching names, pointed
objects, key landmarks and nearby objects. This keeps the small model's context
bounded. The map is caretaker knowledge, including off-screen objects; it is not
an autonomous exploration/discovery simulation. Screenshots remain visual
evidence for appearance, and raycasts provide exact pointed-object identity.
There is no pixel-coordinate guessing for movement.

The engine finds a reachable approach point beside each object's bounds, checks
route clearance, waits for a guided player, rechecks arrival and performs the
interaction at the destination. Navigation uses the current world's limit
(19.5 in the original courtyard, 29 in generated worlds), with spatially indexed
obstacles and lazy grid connectivity. State and screenshot validators use the
same world limit. Ground movement, body clearance and allowed interactions stay
under engine control.

World replacement creates the same caretaker controller with the new registry
and navigation geometry. Disposal cancels previous requests; replies carry the
world ID, and a mismatched world reply is rejected. New worlds get their own
dialogue history and visited-object state. A visual variation of the NPC has no
separate behavior implementation.

The optional Google Decisions adapter still selects legacy fast actions, which
the game maps onto the current registry. The generic structured object planner
is implemented in the default local Qwen adapter.

## Verification

Automated checks cover all six themes, named landmark guidance, inspection,
waystone reading, idempotent lantern state changes, sitting/standing, ambiguous
and missing objects, unsupported interactions, blocked routes, guided waiting,
navigation beyond the original courtyard, validation and stale world replies.
Browser checks exercise courtyard bench use, candy/cupcake travel, a switch to
the frozen world, and generic model-selected targets from unfamiliar wording.

Actual Qwen requests returned the correct object plans for `big cup cake`,
`Read the waystone`, `Go to the bench` and `biggest sugary landmark`, in roughly
1–2 seconds in those samples. Records are in
`artifacts/world-aware-llm-results.json`; an in-game screenshot is in
`artifacts/world-aware-cupcake.png`.

Unit/integration tests run with two workers to avoid exhausting host memory
alongside the installed local models. The GPU runtime uses a small prefill batch
and Flash Attention for vision memory use; avoid duplicate game servers.

Player commands have priority: follow/come here/stop stay active until another
player instruction. They bypass the quick decision service, and an unrelated
LLM response cannot replace them. For broader tasks, the LLM plan overrides quick
decisions regardless of response order. Old responses are cancelled on a new turn.

Contextual and indirect requests also produce executable LLM plans. The keyword
parser is only the immediate reflex layer; it no longer decides whether a turn
may use the LLM action executor. For example, `Jump` followed by `Do it again`
uses the engine's last-action receipt to let the LLM choose a second JUMP.
Clear informational questions still reject unsolicited movement plans.

Engine receipts record the action, running/completed/blocked/cancelled status and
outcome. They are passed to the planner alongside history. Groq action turns use
strict structured output, with primitive and targeted actions normalized into
the shared executor. Plain assistant history is encoded consistently as JSON on
these turns. Speech alone never executes an action. Interaction acknowledgements
describe the pending walk/action; completion is reported only by engine success,
and blocked routes preserve their failure message. A delayed acknowledgement of
an immediate jump cannot cause a duplicate jump in the same turn.

When idle, the LLM can choose up to three supported actions from the current
world state, including object states, location and visited objects. It reassesses
after completing the activity, at most once every 12 seconds. Direct commands
and conversations suspend this autonomy; say **"decide what to do"**, **"patrol"**
or **"explore"** to give it control again. These are model-generated decisions,
not consciousness.

These remain primitive worlds with authored descriptions and supported actions.
Arbitrary manipulation, climbing, free-form spatial construction and advanced
skeletal animation are outside this implementation. The small LLM can still
misinterpret language or images; engine validation limits what it can execute.
