import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Vector3 } from 'three';
import { Navigation } from '../src/game/navigation';
import { Caretaker } from '../src/game/npc';
import { createWorld } from '../src/game/world';

test('navigation routes around obstacles without cutting through expanded corners', () => {
  const wall = new Box3(new Vector3(-1,0,-2),new Vector3(1,3,2));
  const nav = new Navigation([wall]);
  const start = {x:-4,z:0}, end = {x:4,z:0};
  const route = nav.path(start,end);
  assert.ok(route.length > 2);
  let previous = start;
  for (const p of route) { assert.ok(nav.clear(previous,p)); previous=p; }
  assert.deepEqual(route.at(-1),end);
  assert.deepEqual(nav.path({x:0,z:0},end),[]);
});

test('caretaker follows a real route, updates collision, tends lamp once, then waits', () => {
  const world = createWorld();
  const npc = new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp);
  const player = new Vector3(0,0,8);
  npc.apply({action:'TEND_LANTERN',reply:'LANTERN'},player);
  const nav = new Navigation(world.navigationColliders);
  for (let i=0;i<600;i++) {
    npc.step(1/60,player);
    assert.ok(nav.walkable(world.npc.position));
    assert.ok(Math.abs(world.npcCollider.min.x - (world.npc.position.x-.4)) < .00001);
  }
  assert.equal(world.lamp.get(),true);
  assert.ok(npc.visited.has('lantern'));
  npc.apply({action:'WAIT',reply:'WAIT'},player);
  const position = world.npc.position.clone();
  for (let i=0;i<120;i++) npc.step(1/60,player);
  assert.ok(position.equals(world.npc.position));
  assert.equal(world.lamp.get(),true);
  npc.dispose(); world.dispose();
});

test('following respects personal space and reset invalidates an in-flight model answer', async () => {
  const world = createWorld();
  let finish!: (response: Response) => void;
  const fetcher = (() => new Promise<Response>(resolve => {finish=resolve;})) as typeof fetch;
  const npc = new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp,fetcher);
  const player = new Vector3(0,0,8);
  npc.apply({action:'FOLLOW_PLAYER',reply:'FOLLOW'},player);
  for (let i=0;i<600;i++) npc.step(1/60,player);
  assert.ok(world.npc.position.distanceTo(player) >= 2);
  assert.ok(world.npc.position.distanceTo(player) < 2.3);
  npc.setAI(true);
  const pending = npc.command('follow me',player);
  npc.reset();
  finish(Response.json({action:'FOLLOW_PLAYER',reply:'FOLLOW',remaining:4}));
  await pending;
  assert.equal(npc.action,'PATROL');
  assert.equal(npc.busy,false);
  assert.deepEqual(world.npc.position.toArray(),[0,0,-2]);
  npc.dispose(); world.dispose();
});

test('model failures visibly fall back; unsupported responses cannot execute actions',async () => {
  const world=createWorld();
  const npc=new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp,
    (async () => Response.json({action:'RUN_SCRIPT',reply:'WELCOME'})) as typeof fetch);
  npc.setAI(true);
  await npc.command('wait here',new Vector3(0,0,8));
  assert.equal(npc.aiEnabled,false);
  assert.equal(npc.action,'WAIT');
  assert.match(npc.source,/Local fallback/);
  npc.dispose(); world.dispose();
});
