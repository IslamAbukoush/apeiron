# AnyRouter Snake decision test

A small browser Snake game where `vllm-sr/d3-ultra` chooses every move through AnyRouter's typed Decisions API.

## Run

1. Put an AnyRouter LLM API key in `.env.local`:

   ```text
   ANYROUTER_API_KEY=your-key-here
   ```

2. Start the server:

   ```powershell
   npm start
   ```

3. Open <http://localhost:4173> and select **Start AI run**.

The API key stays on the local Node server. The browser sends only the board state to `/api/decision`.

## Test

```powershell
npm test
```

The model receives the board size, ordered snake coordinates, food coordinate, current direction, and calculated safe moves. It returns a typed `choice` plus probabilities for `UP`, `DOWN`, `LEFT`, and `RIGHT`. The interface also reports the server-measured AnyRouter round-trip latency for each move.

Free-plan AnyRouter accounts have a five-request shared trial. Go and higher plans can use decision models without a daily or monthly quota, subject to the Decisions API burst limit.
