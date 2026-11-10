import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Vector3 } from 'three';
import { BODY, PlayerBody, type Movement } from '../src/game/physics';

const floor = new Box3(new Vector3(-50, -1, -50), new Vector3(50, 0, 50));
const idle: Movement = { forward: 0, right: 0, sprint: false, jump: false };
function advance(player: PlayerBody, steps: number, movement = idle, obstacles = [floor]) {
  for (let i = 0; i < steps; i++) player.step(1 / 120, movement, 0, obstacles);
}

test('gravity lands the player on the floor without sinking', () => {
  const player = new PlayerBody();
  player.position.y = 5;
  advance(player, 240);
  assert.equal(player.position.y, 0);
  assert.equal(player.grounded, true);
  assert.equal(player.velocityY, 0);
});

test('jump rises, cannot double jump, and lands on a platform', () => {
  const platform = new Box3(new Vector3(-2, 0, 6), new Vector3(2, 0.5, 10));
  const player = new PlayerBody();
  player.position.y = 0.5;
  advance(player, 1, idle, [floor, platform]);
  player.step(1 / 120, { ...idle, jump: true }, 0, [floor, platform]);
  assert.ok(player.position.y > 0.5);
  const velocity = player.velocityY;
  player.step(1 / 120, { ...idle, jump: true }, 0, [floor, platform]);
  assert.ok(player.velocityY < velocity);
  advance(player, 240, idle, [floor, platform]);
  assert.equal(player.position.y, 0.5);
});

test('sprinting into a thin wall stops at the body boundary', () => {
  const wall = new Box3(new Vector3(-10, 0, 0), new Vector3(10, 4, 0.1));
  const player = new PlayerBody();
  advance(player, 360, { ...idle, forward: 1, sprint: true }, [floor, wall]);
  assert.ok(Math.abs(player.position.z - (0.1 + BODY.radius)) < 0.00001);
});

test('diagonal input is normalized and slides along a wall', () => {
  const straight = new PlayerBody();
  const diagonal = new PlayerBody();
  const start = straight.position.clone();
  advance(straight, 120, { ...idle, forward: 1 });
  advance(diagonal, 120, { ...idle, forward: 1, right: 1 });
  assert.ok(Math.abs(straight.position.distanceTo(start) - diagonal.position.distanceTo(start)) < 0.00001);
  const wall = new Box3(new Vector3(1, 0, -50), new Vector3(2, 4, 50));
  const player = new PlayerBody();
  advance(player, 240, { ...idle, forward: 1, right: 1 }, [floor, wall]);
  assert.ok(player.position.x <= 1 - BODY.radius + 0.00001);
  assert.ok(player.position.z < 4);
});

test('ceiling blocks upward movement and falling out resets safely', () => {
  const ceiling = new Box3(new Vector3(-5, 2, 4), new Vector3(5, 3, 12));
  const player = new PlayerBody();
  advance(player, 1);
  player.step(1 / 120, { ...idle, jump: true }, 0, [floor, ceiling]);
  for (let i = 0; i < 120; i++) {
    advance(player, 1, idle, [floor, ceiling]);
    assert.ok(player.position.y + BODY.height <= 2 + 0.00001);
  }
  player.position.y = -20;
  advance(player, 1);
  assert.deepEqual(player.position.toArray(), [0, 0, 8]);
});
