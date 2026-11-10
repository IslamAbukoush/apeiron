import { Camera, Object3D, Raycaster, Vector2 } from 'three';
import type { Interactable } from './world';

const ray = new Raycaster();
ray.far = 3;
const center = new Vector2();

/** The first visible surface must belong to the target: walls block interaction. */
export function findInteraction(camera: Camera, objects: Object3D[]): Interactable | null {
  ray.setFromCamera(center, camera);
  const hit = ray.intersectObjects(objects, true).find(hit => hit.object.type === 'Mesh');
  let object: Object3D | null = hit?.object ?? null;
  while (object) {
    if (object.userData.interactable) return object.userData.interactable as Interactable;
    object = object.parent;
  }
  return null;
}
