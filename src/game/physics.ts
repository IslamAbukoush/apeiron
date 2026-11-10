import { Box3, Vector3 } from 'three';

export const BODY = { radius: 0.32, height: 1.8, eyeHeight: 1.65 };
export type Movement = { forward: number; right: number; sprint: boolean; jump: boolean };

/** Axis-aligned player body; feet position is authoritative, independent of rendering. */
export class PlayerBody {
  readonly position = new Vector3(0, 0, 8);
  velocityY = 0;
  grounded = false;
  private readonly bounds = new Box3();

  reset() {
    this.position.set(0, 0, 8);
    this.velocityY = 0;
    this.grounded = false;
  }

  private updateBounds() {
    const { x, y, z } = this.position;
    this.bounds.min.set(x - BODY.radius, y, z - BODY.radius);
    this.bounds.max.set(x + BODY.radius, y + BODY.height, z + BODY.radius);
  }

  private overlaps(box: Box3) {
    const a = this.bounds;
    return a.max.x > box.min.x && a.min.x < box.max.x &&
      a.max.y > box.min.y && a.min.y < box.max.y &&
      a.max.z > box.min.z && a.min.z < box.max.z;
  }

  private moveAxis(axis: 'x' | 'y' | 'z', distance: number, colliders: readonly Box3[]) {
    if (distance === 0) return;
    this.position[axis] += distance;
    this.updateBounds();
    for (const box of colliders) {
      if (!this.overlaps(box)) continue;
      if (axis === 'y') {
        this.position.y = distance > 0 ? box.min.y - BODY.height : box.max.y;
        if (distance < 0) this.grounded = true;
        this.velocityY = 0;
      } else {
        this.position[axis] = distance > 0
          ? box.min[axis] - BODY.radius : box.max[axis] + BODY.radius;
      }
      this.updateBounds();
    }
  }

  step(dt: number, input: Movement, yaw: number, colliders: readonly Box3[]) {
    const length = Math.max(1, Math.hypot(input.forward, input.right));
    const speed = input.sprint ? 6 : 3.5;
    const forward = input.forward / length * speed * dt;
    const right = input.right / length * speed * dt;
    this.moveAxis('x', right * Math.cos(yaw) - forward * Math.sin(yaw), colliders);
    this.moveAxis('z', -forward * Math.cos(yaw) - right * Math.sin(yaw), colliders);
    if (input.jump && this.grounded) this.velocityY = 6;
    this.grounded = false;
    this.velocityY -= 18 * dt;
    this.moveAxis('y', this.velocityY * dt, colliders);
    if (this.position.y < -15) this.reset();
  }
}
