import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera } from 'three';
import { findInteraction } from '../src/game/interaction';

test('interaction finds parent identity, respects range and solid occluders', () => {
  const camera = new PerspectiveCamera();
  camera.updateMatrixWorld();
  const npc = new Group();
  npc.userData.interactable = { id: 'npc', kind: 'npc', name: 'Test NPC' };
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  npc.add(mesh);
  npc.position.z = -2;
  npc.updateMatrixWorld(true);
  assert.equal(findInteraction(camera, [npc])?.id, 'npc');
  const wall = new Mesh(mesh.geometry, mesh.material);
  wall.position.z = -1;
  wall.updateMatrixWorld();
  assert.equal(findInteraction(camera, [npc, wall]), null);
  npc.position.z = -5;
  npc.updateMatrixWorld(true);
  assert.equal(findInteraction(camera, [npc]), null);
  mesh.geometry.dispose();
  mesh.material.dispose();
});
