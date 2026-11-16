export const DIRECTIONS = {
  UP: { x: 0, y: -1 },
  DOWN: { x: 0, y: 1 },
  LEFT: { x: -1, y: 0 },
  RIGHT: { x: 1, y: 0 },
};

export function createGame(width = 12, height = 12, random = Math.random) {
  const x = Math.floor(width / 2);
  const y = Math.floor(height / 2);
  const game = {
    width,
    height,
    snake: [{ x, y }, { x: x - 1, y }, { x: x - 2, y }],
    food: null,
    direction: "RIGHT",
    score: 0,
    moves: 0,
    over: false,
  };
  game.food = placeFood(game, random);
  return game;
}

function sameCell(a, b) {
  return a.x === b.x && a.y === b.y;
}

export function placeFood(game, random = Math.random) {
  const empty = [];
  for (let y = 0; y < game.height; y += 1) {
    for (let x = 0; x < game.width; x += 1) {
      if (!game.snake.some((part) => part.x === x && part.y === y)) empty.push({ x, y });
    }
  }
  return empty.length ? empty[Math.floor(random() * empty.length)] : null;
}

export function safeMoves(game) {
  const neck = game.snake[1];
  const tail = game.snake.at(-1);
  return Object.entries(DIRECTIONS)
    .filter(([, delta]) => {
      const next = { x: game.snake[0].x + delta.x, y: game.snake[0].y + delta.y };
      if (sameCell(next, neck)) return false;
      if (next.x < 0 || next.y < 0 || next.x >= game.width || next.y >= game.height) return false;
      const willEat = game.food && sameCell(next, game.food);
      return !game.snake.some((part) => sameCell(part, next) && (willEat || !sameCell(part, tail)));
    })
    .map(([name]) => name);
}

export function advance(game, direction, random = Math.random) {
  if (game.over) return game;
  const delta = DIRECTIONS[direction];
  if (!delta) throw new Error(`Unknown direction: ${direction}`);

  const head = game.snake[0];
  const next = { x: head.x + delta.x, y: head.y + delta.y };
  const ate = game.food && sameCell(next, game.food);
  const bodyToCheck = ate ? game.snake : game.snake.slice(0, -1);
  const collision = next.x < 0 || next.y < 0 || next.x >= game.width || next.y >= game.height
    || bodyToCheck.some((part) => sameCell(part, next));

  if (collision) return { ...game, direction, moves: game.moves + 1, over: true };

  const snake = [next, ...game.snake];
  if (!ate) snake.pop();
  const updated = {
    ...game,
    snake,
    direction,
    score: game.score + (ate ? 1 : 0),
    moves: game.moves + 1,
  };
  updated.food = ate ? placeFood(updated, random) : game.food;
  updated.over = updated.food === null;
  return updated;
}

export function decisionState(game) {
  return {
    board: { width: game.width, height: game.height, origin: "top-left" },
    snake: game.snake,
    food: game.food,
    currentDirection: game.direction,
    safeMoves: safeMoves(game),
    rules: "Coordinates increase right and down. Hitting a wall or the snake ends the game.",
  };
}

