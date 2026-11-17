import { Box3 } from 'three';
import type { Point } from './npc-contract';

/** Half-metre grid, inflated for the caretaker's body. No diagonal corner cutting. */
export class Navigation {
  readonly radius = 0.48;
  private readonly edges = new Map<string, Point[]>();
  private readonly buckets=new Map<string,Box3[]>();
  constructor(obstacles:readonly Box3[],readonly limit=19.5) {
    for(const box of obstacles){
      if(box.max.y<=.05||box.min.y>=1.9)continue;
      for(let x=Math.floor((box.min.x-this.radius)/4);x<=Math.floor((box.max.x+this.radius)/4);x++)
        for(let z=Math.floor((box.min.z-this.radius)/4);z<=Math.floor((box.max.z+this.radius)/4);z++){
          const key=`${x},${z}`;if(!this.buckets.has(key))this.buckets.set(key,[]);this.buckets.get(key)!.push(box);
        }
    }
  }
  walkable(p: Point) {
    return Math.abs(p.x)<=this.limit&&Math.abs(p.z)<=this.limit&&!this.buckets.get(`${Math.floor(p.x/4)},${Math.floor(p.z/4)}`)?.some(box=>
      p.x>box.min.x-this.radius&&p.x<box.max.x+this.radius&&p.z>box.min.z-this.radius&&p.z<box.max.z+this.radius);
  }
  private neighbors(p:Point){
    const key=`${p.x},${p.z}`;let edges=this.edges.get(key);
    if(!edges){edges=[[.5,0],[-.5,0],[0,.5],[0,-.5]].map(([dx,dz])=>({x:p.x+dx,z:p.z+dz})).filter(next=>this.clear(p,next));this.edges.set(key,edges);}
    return edges;
  }
  approach(start:Point,bounds:{minX:number;maxX:number;minZ:number;maxZ:number}):Point[]{
    const cx=Math.max(bounds.minX,Math.min(bounds.maxX,start.x)),cz=Math.max(bounds.minZ,Math.min(bounds.maxZ,start.z));
    const points:Point[]=[];for(const gap of [.9,1.4]){points.push({x:cx,z:bounds.minZ-gap},{x:cx,z:bounds.maxZ+gap},{x:bounds.minX-gap,z:cz},{x:bounds.maxX+gap,z:cz});
    for(const x of [bounds.minX-gap,(bounds.minX+bounds.maxX)/2,bounds.maxX+gap])for(const z of [bounds.minZ-gap,bounds.maxZ+gap])points.push({x,z});}
    points.sort((a,b)=>Math.hypot(a.x-start.x,a.z-start.z)-Math.hypot(b.x-start.x,b.z-start.z));
    for(const point of points){if(!this.walkable(point))continue;const route=this.path(start,point);if(route.length){const end=route[route.length-1];const distance=Math.hypot(Math.max(bounds.minX-end.x,0,end.x-bounds.maxX),Math.max(bounds.minZ-end.z,0,end.z-bounds.maxZ));if(distance<=1.75)return route;}}
    return [];
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
    const endKey=key(end);
    for (let i=0; i<queue.length; i++) {
      const p = queue[i];
      if (key(p) === endKey) {
        const route = [p]; let parent = previous.get(key(p));
        while (parent) { route.push(parent); parent = previous.get(key(parent)); }
        return route.reverse();
      }
      for (const next of this.neighbors(p)) {
        if (!previous.has(key(next))) { previous.set(key(next),p); queue.push(next); }
      }
    }
    return [];
  }
}
