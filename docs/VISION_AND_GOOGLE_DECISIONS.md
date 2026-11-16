# Screenshot reliability and Google decisions

The keyword filter introduced for speed could omit screenshots from ordinary
object questions such as “What color is the lantern?”. Screenshot sharing now
attaches a freshly rendered game view on every submitted message when checked.
The exact latest screenshot is available in chat under Latest screenshot sent.
The backend validates the image and returns X-NPC-Vision; the chat distinguishes
server receipt from text-only messages. This confirms transport, not perfect
visual understanding. Both REST and Live instructions explicitly ground visual
answers in the supplied image rather than target labels or invented scenery.

The game now uses Google's Gemini Decision 1 directly:

- Endpoint: `https://generativelanguage.googleapis.com/v1beta/decisions`
- Model: `gemini-decision-1`, using the server-only `GEMINI_API_KEY`.
- Input: compact serialized courtyard state and allowed action/reply questions.
- Optional `GEMINI_DECISION_MODEL` and `GEMINI_DECISION_LIMIT` settings.
- No default local attempt cap; Google quotas still apply. Busy protection,
  cooldown, origin checks, state validation and no-retry behavior remain.
- The fast controller remains opt-in through its existing menu checkbox.

The AnyRouter Snake demo under AI-TEST is preserved separately. The game backend
does not load its key or send inference requests to AnyRouter.

Validation: 26 unit tests passed, including exact image-byte forwarding to Google
and response acknowledgement, plus the direct Google decision adapter contract.
Browser tests cover the previously missed object-color question, screenshot
preview, receipt status, opt-out, NPC movement, voice and world generation.
The production build passed. One browser test was interrupted by the intentional
Vite config reload during this run and was rerun after configuration settled.

Real calls: Google Decision 1 returned FOLLOW_PLAYER/FOLLOW in 1171 ms. A real
game screenshot question about the left lantern returned “pale yellowish-tan
shade” through Flash Lite; server image receipt was confirmed. The resulting
chat and game view were visually inspected.

Reference: [Google Decisions API](https://aistudio.google.com/docs/decisions-api).
