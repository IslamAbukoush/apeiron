# Shared observation and world activities

When a screenshot-enabled visual question is submitted, the caretaker first walks
to a reachable vantage point beside the pointed/named object. A broad scene
question joins the player's viewpoint and viewing direction when available. It
turns toward the subject, checks obstruction, and captures a fresh eye-level image
with its own mesh hidden. Only then does the selected LLM answer. Hybrid mode
still processes the image locally and sends just the observation text to Groq.

The player can move while the caretaker approaches. Another command or model
switch cancels the old observation. Unreachable or obstructed subjects are
reported to the LLM as engine facts without forwarding the remote player image.
The approach has a 60-second gameplay timeout and pauses with the game. The
screenshot preview shows the new NPC-eye image. Text-only conversation does not
require movement. Physical approach time is additional to model inference time.

Every courtyard and generated theme also has:

* **Courtyard bell** at (-3, 11): `Ring the bell`. Swings, sounds a local synthesized
  chime, and tracks strike count.
* **Flower garden** at (3, 11): `Water the flowers`. Changes dry soil to watered
  state and visibly grows three flowers. Repeated watering is idempotent.
* **Crystal treasure chest** at (0, -7): `Open the chest` / `Close the chest`. An
  animated lid reveals/hides three floating crystals. Explicit open/close requests
  are idempotent; the player's E-menu button toggles the state.

The player can use E on these objects, or ask the NPC to approach and interact.
The same affordances and current states are retrieved into LLM context. Existing
navigation and interaction-range checks apply in every world. States last for
the current world instance; creating a new world/reloading resets them. Actions
and effects do not emit canned NPC dialogue.
