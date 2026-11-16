import test from "node:test";
import assert from "node:assert/strict";
import { advance, createGame, decisionState, safeMoves } from "../public/engine.js";

test("creates a playable board with valid state", () => {
  const game = createGame(12, 12, () => 0);
  assert.equal(game.snake.length, 3);
  assert.ok(game.food);
  assert.deepEqual(decisionState(game).safeMoves, ["UP", "DOWN", "RIGHT"]);
});

test("advances the snake without growing when no food is eaten", () => {
  const game = createGame(12, 12, () => 0);
  const next = advance(game, "RIGHT", () => 0);
  assert.equal(next.snake.length, 3);
  assert.equal(next.moves, 1);
  assert.equal(next.over, false);
});

test("reports no safe move for a trapped head", () => {
  const game = {
    width: 3,
    height: 3,
    snake: [
      { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 }, { x: 0, y: 1 },
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 },
    ],
    food: null,
    direction: "UP",
    score: 0,
    moves: 0,
    over: false,
  };
  assert.deepEqual(safeMoves(game), []);
});
