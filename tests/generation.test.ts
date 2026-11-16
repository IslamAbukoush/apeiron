import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Vector3 } from 'three';
import { generateWorld, type Theme } from '../src/game/generation';
import { createGeneratedWorld } from '../src/game/generated-world';
import { PlayerBody } from '../src/game/physics';

test('candy prompts produce sweet geometry, a pink palette and reproducible serializable maps', () => {
  const definition = generateWorld('Candy world', 'sugar');
  assert.equal(definition.theme, 'candy');
  assert.equal(definition.palette.ground, '#ec9ac7');
  assert.ok(definition.props.some(prop => prop.kind === 'lollipop'));
  assert.ok(definition.props.some(prop => prop.kind === 'gumdrop'));
  assert.ok(definition.props.some(prop => prop.kind === 'candyTree'));
  assert.deepEqual(generateWorld('Candy world', 'sugar'), definition);
  assert.deepEqual(JSON.parse(JSON.stringify(definition)), definition);
  assert.notDeepEqual(generateWorld('Candy world', 'another').props, definition.props);
  assert.equal(generateWorld('a world with candyes').theme, 'candy');
});

test('themes and supported prompt modifiers affect the map', () => {
  for (const [prompt, theme] of [
    ['enchanted forest', 'forest'], ['sandy desert', 'desert'], ['frozen snow', 'frozen'],
    ['lava volcano', 'volcanic'], ['alien planet', 'cosmic'],
  ] as const) assert.equal(generateWorld(prompt).theme, theme);
  const lush = generateWorld('lush blue candy world at night');
  assert.equal(lush.night, true);
  assert.equal(lush.palette.ground, '#86bce5');
  assert.ok(lush.props.length > generateWorld('sparse candy world').props.length);
  assert.equal(generateWorld('a quiet city of libraries').fallback, true);
  assert.equal(generateWorld('a world of sandcastles').fallback, true, 'keywords match whole words');
  assert.throws(() => generateWorld('   '), /Describe/);
  assert.throws(() => generateWorld('a'.repeat(601)), /600/);
  assert.throws(() => generateWorld('forest', 'a'.repeat(65)), /64/);
});

test('every generated theme has safe spawn, connected walking paths and working collisions', () => {
  const prompts: Record<Theme, string> = { candy: 'candy', forest: 'forest', desert: 'desert', frozen: 'frozen', volcanic: 'lava', cosmic: 'cosmic' };
  for (const prompt of Object.values(prompts)) {
    for (const seed of ['one', 'two', 'three']) {
      const definition = generateWorld(prompt, seed);
      const world = createGeneratedWorld(definition);
      try {
        const spawn = new Box3(new Vector3(-0.32, 0.01, 7.68), new Vector3(0.32, 1.8, 8.32));
        assert.ok(world.colliders.every(collider => !collider.intersectsBox(spawn)), `${prompt}: spawn is clear`);
        assert.ok(world.scene.children.length > definition.props.length);
        assert.ok(definition.props.every(prop => Math.abs(prop.x) > 5 && Math.abs(prop.z) > 5));
        const player = new PlayerBody();
        for (let step = 0; step < 120; step++) player.step(1 / 120, { forward: 0, right: 0, jump: false, sprint: false }, 0, world.colliders);
        assert.ok(player.grounded);
        assert.equal(player.position.y, 0);
        // Walk beside the caretaker along the north/south path to the landmark.
        player.position.x = 1.8;
        for (let step = 0; step < 1800; step++) player.step(1 / 120, { forward: 1, right: 0, jump: false, sprint: true }, 0, world.colliders);
        assert.ok(player.position.z < -10, `${prompt}: landmark can be reached`);
        // The outer strip bypasses scenery and reaches the perimeter itself.
        player.position.set(28, 0, 8);
        for (let step = 0; step < 1800; step++) player.step(1 / 120, { forward: 1, right: 0, jump: false, sprint: true }, 0, world.colliders);
        assert.ok(Math.abs(player.position.z + 29.18) < 0.001, `${prompt}: boundary stops the player`);
      } finally {
        world.dispose();
      }
    }
  }
});
