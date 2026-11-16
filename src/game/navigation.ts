import { Box3 } from 'three';
import type { Point } from './npc-contract';

/** Half-metre grid, inflated for the caretaker's body. No diagonal corner cutting. */
export class Navigation {
  readonly radius = 0.48;
  private readonly edges = new Map<string, Point[]>();
  constructor(private readonly obstacles: readonly Box3[]) {
    // Static courtyard connectivity is computed once, rather than on every follow update.
    for (let x=-19.5;x<=19.5;x+=.5) for (let z=-19.5;z<=19.5;z+=.5) {
      const p={x,z};
      if (this.walkable(p)) this.edges.set(`${x},${z}`,[[.5,0],[-.5,0],[0,.5],[0,-.5]]
        .map(([dx,dz])=>({x:x+dx,z:z+dz})).filter(next=>this.clear(p,next)));
    }
  }
  walkable(p: Point) {
    return Math.abs(p.x) <= 19.5 && Math.abs(p.z) <= 19.5 && !this.obstacles.some(b =>
      b.max.y > 0.05 && b.min.y < 1.9 && p.x > b.min.x - this.radius && p.x < b.max.x + this.radius &&
      p.z > b.min.z - this.radius && p.z < b.max.z + this.radius);
  }
  clear(a: Point, b: Point) {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x-a.x, b.z-a.z) / 0.1));
    for (let i=0; i<=steps; i++) if (!this.walkable({ x:a.x+(b.x-a.x)*i/steps, z:a.z+(b.z-a.z)*i/steps })) return false;
    return true;
  }
  path(start: Point, goal: Point): Point[] {
    if (!this.walkable(start)) return [];
    const snap = (p: Point) => ({ x:Math.round(p.x*2)/2, z:Math.round(p.z*2)/2 });
    const key = (p: Point) => `${p.x},${p.z}`;
    let end = snap(goal);
    if (!this.walkable(end)) {
      const candidates: Point[] = [];
      for (let x=-6; x<=6; x++) for (let z=-6; z<=6; z++) {
        const p = { x:end.x+x/2, z:end.z+z/2 }; if (this.walkable(p)) candidates.push(p);
      }
      candidates.sort((a,b) => Math.hypot(a.x-goal.x,a.z-goal.z)-Math.hypot(b.x-goal.x,b.z-goal.z));
      if (!candidates.length) return []; end = candidates[0];
    }
    if (this.clear(start,end)) return [end];
    // Seed all nearby grid cells visible from the exact (non-grid) start.
    const origin = snap(start), queue: Point[] = [], previous = new Map<string, Point | null>();
    for (let x=-1; x<=1; x++) for (let z=-1; z<=1; z++) {
      const p = {x:origin.x+x/2,z:origin.z+z/2};
      if (this.clear(start,p)) { queue.push(p); previous.set(key(p),null); }
    }
    for (let i=0; i<queue.length; i++) {
      const p = queue[i];
      if (key(p) === key(end)) {
        const route = [p]; let parent = previous.get(key(p));
        while (parent) { route.unshift(parent); parent = previous.get(key(parent)); }
        return route;
      }
      for (const next of this.edges.get(key(p)) || []) {
        if (!previous.has(key(next))) { previous.set(key(next),p); queue.push(next); }
      }
    }
    return [];
  }
}
