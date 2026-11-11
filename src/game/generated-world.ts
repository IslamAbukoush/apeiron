import * as THREE from 'three';
import type { WorldDefinition, PropKind } from './generation';
import { disposeScene, type Interactable } from './world';

/** Build visuals from saved data; simple collision proxies keep generated scenery playable. */
export function createGeneratedWorld(definition: WorldDefinition) {
  const { palette, theme, night } = definition;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.sky);
  scene.fog = new THREE.Fog(palette.sky, 30, 90);
  const colliders: THREE.Box3[] = [];
  const cache = new Map<string, THREE.MeshStandardMaterial>();
  function material(color: string, glow = false) {
    const key = `${color}:${glow}`;
    if (!cache.has(key)) cache.set(key, new THREE.MeshStandardMaterial({
      color, roughness: theme === 'candy' ? 0.38 : 0.85, flatShading: true,
      emissive: glow ? color : '#000000', emissiveIntensity: glow ? 0.3 : 0,
    }));
    return cache.get(key)!;
  }
  const white = material('#fff2e4');
  const trunk = material(palette.trunk);
  function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, mat: THREE.Material,
    x: number, y: number, z: number) {
    const object = new THREE.Mesh(geometry, mat);
    object.position.set(x, y, z);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  function collider(x: number, z: number, radius: number, height: number, y = 0) {
    colliders.push(new THREE.Box3(new THREE.Vector3(x - radius, y, z - radius), new THREE.Vector3(x + radius, y + height, z + radius)));
  }
  function box(x: number, y: number, z: number, w: number, h: number, d: number, color: string, solid = true) {
    const object = mesh(scene, new THREE.BoxGeometry(w, h, d), material(color), x, y + h / 2, z);
    if (solid) colliders.push(new THREE.Box3(new THREE.Vector3(x - w / 2, y, z - d / 2), new THREE.Vector3(x + w / 2, y + h, z + d / 2)));
    return object;
  }
  box(0, -1, 0, 60, 1, 60, palette.ground);
  box(0, 0.002, 0, 5, 0.015, 58, palette.path, false);
  box(0, 0.003, 0, 58, 0.015, 5, palette.path, false);
  // Continuous visible perimeter, also used for collision.
  for (const x of [-30, 30]) box(x, 0, 0, 1, 2, 61, palette.accent);
  for (const z of [-30, 30]) box(0, 0, z, 60, 2, 1, palette.accent);

  function prop(kind: PropKind, group: THREE.Group, color: string) {
    const accent = material(color, theme === 'cosmic' || theme === 'volcanic');
    switch (kind) {
      case 'lollipop': {
        mesh(group, new THREE.CylinderGeometry(0.12, 0.12, 2.7, 8), white, 0, 1.35, 0);
        mesh(group, new THREE.CylinderGeometry(0.9, 0.9, 0.3, 24), accent, 0, 3.1, 0).rotation.x = Math.PI / 2;
        mesh(group, new THREE.TorusGeometry(0.55, 0.1, 6, 24), white, 0, 3.1, 0.18);
        mesh(group, new THREE.SphereGeometry(0.18, 8, 6), white, 0, 3.1, 0.19);
        return { radius: 0.25, height: 4.1 };
      }
      case 'candyTree':
      case 'tree': {
        mesh(group, new THREE.CylinderGeometry(0.2, 0.35, 3.5, 7), trunk, 0, 1.75, 0);
        for (const [x, y, z] of [[0, 4, 0], [-0.8, 3.5, 0.15], [0.8, 3.5, 0.1]]) {
          const crown = mesh(group, new THREE.IcosahedronGeometry(1.25, 1), accent, x, y, z);
          crown.scale.y = kind === 'candyTree' ? 0.8 : 1.2;
        }
        return { radius: 0.4, height: 5.7 };
      }
      case 'gumdrop': {
        const drop = mesh(group, new THREE.SphereGeometry(0.9, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), accent, 0, 0, 0);
        drop.scale.y = 1.6;
        for (let i = 0; i < 6; i++) {
          const angle = i * Math.PI / 3;
          mesh(group, new THREE.IcosahedronGeometry(0.07), white, Math.cos(angle) * 0.63, 0.9, Math.sin(angle) * 0.63);
        }
        return { radius: 0.9, height: 1.44 };
      }
      case 'mushroom':
        mesh(group, new THREE.CylinderGeometry(0.2, 0.35, 1.7, 8), white, 0, 0.85, 0);
        mesh(group, new THREE.SphereGeometry(1.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), accent, 0, 1.6, 0);
        return { radius: 0.35, height: 2.8 };
      case 'cactus':
        mesh(group, new THREE.CapsuleGeometry(0.35, 2.5, 4, 8), accent, 0, 1.6, 0);
        for (const side of [-1, 1]) {
          mesh(group, new THREE.CylinderGeometry(0.17, 0.17, 0.8, 6), accent, side * 0.5, 1.5, 0).rotation.z = Math.PI / 2;
          mesh(group, new THREE.CapsuleGeometry(0.18, 0.7, 4, 6), accent, side * 0.85, 1.9, 0);
        }
        return { radius: 1, height: 3.3 };
      case 'crystal':
        for (const [x, y, z, size] of [[0, 1.6, 0, 1], [-0.6, 0.8, 0.2, 0.6], [0.6, 0.9, -0.1, 0.55]]) {
          const shard = mesh(group, new THREE.OctahedronGeometry(size), accent, x, y, z);
          shard.scale.set(0.7, 2, 0.7);
        }
        return { radius: 1.05, height: 3.6 };
      case 'rock': {
        const rock = mesh(group, new THREE.DodecahedronGeometry(1.1), accent, 0, 0.65, 0);
        rock.scale.set(1, 0.8, 0.9);
        return { radius: 1.1, height: 1.6 };
      }
    }
  }

  for (const item of definition.props) {
    const group = new THREE.Group();
    group.name = item.id;
    group.position.set(item.x, 0, item.z);
    group.rotation.y = item.rotation;
    group.scale.setScalar(item.scale);
    scene.add(group);
    const bounds = prop(item.kind, group, item.color);
    // Rotated wide shapes use a conservative proxy.
    collider(item.x, item.z, bounds.radius * item.scale, bounds.height * item.scale);
  }

  const landmark = new THREE.Group();
  landmark.position.set(0, 0, -15);
  scene.add(landmark);
  const accent = material(palette.accent, theme === 'cosmic' || theme === 'volcanic');
  if (theme === 'candy') {
    mesh(landmark, new THREE.CylinderGeometry(2.7, 2, 2.7, 12), material('#ac765e'), 0, 1.35, 0);
    mesh(landmark, new THREE.SphereGeometry(2.8, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), white, 0, 2.7, 0);
    mesh(landmark, new THREE.SphereGeometry(0.55, 12, 8), accent, 0, 5.8, 0);
    for (let i = 0; i < 14; i++) {
      const angle = i * 2.39996;
      const sprinkle = mesh(landmark, new THREE.BoxGeometry(0.12, 0.12, 0.4), i % 2 ? accent : material(palette.secondary),
        Math.cos(angle) * 2, 4.6, Math.sin(angle) * 2);
      sprinkle.rotation.y = angle;
    }
  } else if (theme === 'desert') {
    for (let i = 0; i < 5; i++) mesh(landmark, new THREE.BoxGeometry(6 - i, 1.1, 6 - i), material(palette.secondary), 0, i * 1.1 + 0.55, 0);
  } else if (theme === 'forest') {
    prop('tree', landmark, palette.accent);
    landmark.scale.setScalar(1.8);
  } else if (theme === 'volcanic') {
    mesh(landmark, new THREE.CylinderGeometry(1, 3.4, 6, 9), trunk, 0, 3, 0);
    mesh(landmark, new THREE.TorusGeometry(0.8, 0.24, 8, 20), accent, 0, 6, 0).rotation.x = Math.PI / 2;
  } else {
    mesh(landmark, new THREE.OctahedronGeometry(2), accent, 0, 3.3, 0).scale.y = 2.6;
    if (theme === 'cosmic') mesh(landmark, new THREE.TorusGeometry(3.2, 0.13, 8, 40), white, 0, 3.8, 0).rotation.x = Math.PI / 3;
  }
  collider(0, -15, theme === 'forest' ? 0.8 : 3.5, 9);

  const npc = new THREE.Group();
  npc.position.set(0, 0, -2);
  npc.userData.interactable = { id: 'caretaker', name: 'The caretaker', kind: 'npc' } satisfies Interactable;
  mesh(npc, new THREE.ConeGeometry(0.42, 1.25, 8), accent, 0, 0.85, 0);
  mesh(npc, new THREE.IcosahedronGeometry(0.23, 1), white, 0, 1.65, 0);
  scene.add(npc);
  collider(0, -2, 0.4, 1.9);
  const marker = box(3.4, 0, 3, 0.8, 1.4, 0.6, palette.secondary);
  marker.userData.interactable = { id: 'waystone', name: 'World waystone', kind: 'marker' } satisfies Interactable;
  // Low surfaces retain jumping practice in every generated map.
  box(-4, 0, 7, 2, 0.45, 2, palette.secondary);
  box(-6, 0, 7, 2, 0.9, 2, palette.accent);

  scene.add(new THREE.HemisphereLight(night ? '#b9c7ff' : '#fff5e7', palette.ground, night ? 1.6 : 2.4));
  const sun = new THREE.DirectionalLight(night ? '#b4c6ff' : '#fff2dc', night ? 1.4 : 3);
  sun.position.set(-15, 28, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 100 });
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  const debug = new THREE.Group();
  for (const bounds of colliders) debug.add(new THREE.Box3Helper(bounds, '#e8ce73'));
  debug.visible = false;
  scene.add(debug);
  scene.updateMatrixWorld(true);
  return { scene, colliders, debug, dispose: () => disposeScene(scene) };
}
