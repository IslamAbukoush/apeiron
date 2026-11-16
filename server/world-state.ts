import type {WorldSnapshot,WorldObject} from '../src/game/world-contract.ts';

export function validateWorld(value:unknown):WorldSnapshot|undefined{
  if(value===undefined)return;
  const world=value as WorldSnapshot;
  if(!world||typeof world.id!=='string'||world.id.length>100||typeof world.name!=='string'||world.name.length>100||!Number.isFinite(world.limit)||world.limit<1||world.limit>64||!Array.isArray(world.objects)||world.objects.length>100)throw Error('Invalid world');
  const ids=new Set<string>();
  const objects=world.objects.map((object:WorldObject)=>{
    const string=(s:unknown,max=300)=>typeof s==='string'&&s.length<=max;
    if(!object||!string(object.id,80)||!/^[a-zA-Z0-9_-]+$/.test(object.id)||ids.has(object.id)||!string(object.name,100)||!string(object.kind,60)||!string(object.color,30)||!string(object.description)||!string(object.state,100)||!Array.isArray(object.aliases)||object.aliases.length>15||object.aliases.some(alias=>!string(alias,80))||!Array.isArray(object.actions)||object.actions.length>3||object.actions.some(action=>!['read','toggle','sit'].includes(action))||!object.position||![object.position.x,object.position.z].every(n=>Number.isFinite(n)&&Math.abs(n)<=world.limit)||!object.bounds||![object.bounds.minX,object.bounds.maxX,object.bounds.minZ,object.bounds.maxZ].every(n=>Number.isFinite(n)&&Math.abs(n)<=80)||object.bounds.minX>object.bounds.maxX||object.bounds.minZ>object.bounds.maxZ)throw Error('Invalid world object');
    ids.add(object.id);return {id:object.id,name:object.name,kind:object.kind,color:object.color,description:object.description,state:object.state,position:{...object.position},bounds:{...object.bounds},aliases:[...object.aliases],actions:[...object.actions]};
  });
  return {id:world.id,name:world.name,limit:world.limit,objects};
}
