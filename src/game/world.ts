import * as THREE from 'three';

export type Interactable = { id: string; name: string; kind: 'npc' | 'marker' };

export function disposeScene(scene: THREE.Scene) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  scene.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    }
    if (object instanceof THREE.DirectionalLight) object.shadow.dispose();
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
}

export function createWorld() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#c6c3ac');
  scene.fog = new THREE.Fog('#c6c3ac', 24, 75);
  const colliders: THREE.Box3[] = [];
  const materials = {
    stone: new THREE.MeshStandardMaterial({ color: '#b2ab92', roughness: 0.95 }),
    darkStone: new THREE.MeshStandardMaterial({ color: '#797c6c', roughness: 1 }),
    ground: new THREE.MeshStandardMaterial({ color: '#777f57', roughness: 1 }),
    path: new THREE.MeshStandardMaterial({ color: '#b6ac8a', roughness: 1 }),
    wood: new THREE.MeshStandardMaterial({ color: '#68543b', roughness: 1 }),
    leaves: new THREE.MeshStandardMaterial({ color: '#566747', roughness: 1, flatShading: true }),
    cloth: new THREE.MeshStandardMaterial({ color: '#846d49', roughness: 1 }),
    face: new THREE.MeshStandardMaterial({ color: '#c7ad88', roughness: 1 }),
  };

  function box(x: number, y: number, z: number, w: number, h: number, d: number,
    material: THREE.Material, solid = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (solid) colliders.push(new THREE.Box3(
      new THREE.Vector3(x - w / 2, y, z - d / 2),
      new THREE.Vector3(x + w / 2, y + h, z + d / 2),
    ));
    return mesh;
  }

  box(0, -1, 0, 42, 1, 42, materials.ground);
  box(0, 0.002, 1, 3.8, 0.015, 28, materials.path, false);
  box(0, 0.003, -3, 21, 0.015, 3.8, materials.path, false);
  // Visible perimeter walls also form the playable boundary.
  box(-21, 0, 0, 1, 3, 43, materials.darkStone);
  box(21, 0, 0, 1, 3, 43, materials.darkStone);
  box(0, 0, -21, 42, 3, 1, materials.darkStone);
  box(0, 0, 21, 42, 3, 1, materials.darkStone);

  // Colonnade, arch and low jump platforms.
  for (const x of [-6, 6]) {
    for (const z of [-11, -4, 3]) {
      box(x, 0, z, 1.5, 0.3, 1.5, materials.darkStone);
      box(x, 0.3, z, 0.85, 4.1, 0.85, materials.stone);
      box(x, 4.4, z, 1.4, 0.35, 1.4, materials.stone);
    }
    box(x, 4.75, -4, 1.3, 0.45, 15, materials.stone);
  }
  box(0, 4.4, -11, 12, 0.7, 1.4, materials.stone);
  box(-10, 0, 4, 3, 0.45, 2.6, materials.stone);
  box(-12, 0, 4, 1.5, 0.9, 2.6, materials.stone);
  box(9, 0, 6, 1.7, 1.4, 1.7, materials.wood);
  box(11, 0, 7, 1.3, 0.7, 1.3, materials.wood);
  box(-9, 0, -9, 3, 0.55, 1.5, materials.stone);

  // Deterministic placeholder foliage; no remote assets or model calls.
  for (let i = 0; i < 24; i++) {
    const angle = i * 2.39996;
    const radius = 14 + (i % 4) * 1.2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    box(x, 0, z, 0.55, 3.5, 0.55, materials.wood);
    const canopy = new THREE.Mesh(new THREE.IcosahedronGeometry(2 + i % 3 * 0.25, 1), materials.leaves);
    canopy.position.set(x, 4.1 + i % 3 * 0.3, z);
    canopy.scale.set(1, 1.25, 1);
    canopy.castShadow = true;
    scene.add(canopy);
  }

  const npc = new THREE.Group();
  npc.position.set(0, 0, -2);
  npc.userData.interactable = { id: 'caretaker', name: 'The caretaker', kind: 'npc' } satisfies Interactable;
  const torso = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.25, 8), materials.cloth);
  torso.position.y = 0.85;
  npc.add(torso);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.23, 1), materials.face);
  head.position.y = 1.65;
  npc.add(head);
  for (const x of [-0.15, 0.15]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.3, 0.32), materials.wood);
    foot.position.set(x, 0.15, 0.06);
    npc.add(foot);
  }
  npc.traverse(object => { if (object instanceof THREE.Mesh) object.castShadow = true; });
  scene.add(npc);
  colliders.push(new THREE.Box3(new THREE.Vector3(-0.4, 0, -2.4), new THREE.Vector3(0.4, 1.9, -1.6)));

  const marker = box(3.4, 0, 3, 0.8, 1.4, 0.6, materials.darkStone);
  marker.userData.interactable = { id: 'waystone', name: 'Weathered waystone', kind: 'marker' } satisfies Interactable;

  scene.add(new THREE.HemisphereLight('#fff2d5', '#65724b', 2));
  const sun = new THREE.DirectionalLight('#ffe1ae', 3);
  sun.position.set(-15, 23, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 1, far: 85 });
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.updateMatrixWorld(true);

  const debug = new THREE.Group();
  for (const collider of colliders) debug.add(new THREE.Box3Helper(collider, '#e8ce73'));
  debug.visible = false;
  scene.add(debug);

  return {
    scene, colliders, debug,
    dispose: () => disposeScene(scene),
  };
}
