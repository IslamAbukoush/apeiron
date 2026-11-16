import type {Point,ViewContext} from './npc-contract.ts';

export type WorldInteraction='read'|'toggle'|'sit';
export type WorldObject={id:string;name:string;aliases:string[];kind:string;color:string;description:string;position:Point;bounds:{minX:number;maxX:number;minZ:number;maxZ:number};actions:WorldInteraction[];state:string};
export type WorldSnapshot={id:string;name:string;limit:number;objects:WorldObject[]};
export const OBJECT_ACTIONS=['GO_TO_OBJECT','GUIDE_TO_OBJECT','INSPECT_OBJECT','INTERACT_OBJECT'] as const;
export type ObjectStep={action:typeof OBJECT_ACTIONS[number];targetId:string;interaction?:WorldInteraction;state?:'on'|'off'};
const normalize=(text:string)=>text.toLowerCase().replace(/cup\s+cake/g,'cupcake').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();

export function findObjects(query:string,objects:WorldObject[],origin:Point):WorldObject[]{
  const text=` ${normalize(query)} `;
  const ranked=objects.map(object=>{
    const phrases=[object.name,...object.aliases,object.kind].map(normalize);
    const score=Math.max(0,...phrases.map(phrase=>text.includes(` ${phrase} `)?phrase.split(' ').length:0));
    const color=object.color && text.includes(` ${normalize(object.color)} `)?1:0;
    return {object,score:score?score+color:0};
  }).filter(item=>item.score>0);
  const best=Math.max(0,...ranked.map(item=>item.score));
  let matches=ranked.filter(item=>item.score===best).map(item=>item.object);
  if(/\b(biggest|largest|smallest)\b/i.test(query))matches=matches.sort((a,b)=>((b.bounds.maxX-b.bounds.minX)*(b.bounds.maxZ-b.bounds.minZ)-(a.bounds.maxX-a.bounds.minX)*(a.bounds.maxZ-a.bounds.minZ))*(/\bsmallest\b/i.test(query)?-1:1)).slice(0,1);
  if(/\b(nearest|closest)\b/i.test(query))matches=matches.sort((a,b)=>Math.hypot(a.position.x-origin.x,a.position.z-origin.z)-Math.hypot(b.position.x-origin.x,b.position.z-origin.z)).slice(0,1);
  return matches;
}

/** Resolve explicit names/pointing locally; unfamiliar descriptions remain available to the LLM. */
export function resolveObjectRequest(request:string,world:WorldSnapshot,origin:Point,target?:ViewContext['target']):{step?:ObjectStep;error?:string;candidates:WorldObject[]}{
  const guide=/\b(show|guide|lead|take me)\b/i.test(request);
  const inspect=/\b(inspect|examine|read)\b/i.test(request);
  const interact=/\b(sit|toggle|tend|light|switch|turn)\b/i.test(request);
  const go=/\b(go|walk|move|stand|visit|come)\b/i.test(request);
  if(!guide&&!inspect&&!interact&&!go)return {candidates:[]};
  if(/\bthen\b|;/.test(request))return {candidates:findObjects(request,world.objects,origin)};
  let matches=findObjects(request,world.objects,origin);
  if(matches.length&&/\b(this|that|there|it)\b/i.test(request)&&target?.objectId&&matches.some(object=>object.id===target.objectId))matches=matches.filter(object=>object.id===target.objectId);
  if(!matches.length&&/\b(this|that|there|it)\b/i.test(request)&&target?.objectId)matches=world.objects.filter(object=>object.id===target.objectId);
  if(matches.length>1)return {error:`Which one do you mean: ${matches.slice(0,3).map(object=>object.name).join(', ')}? You can point at one or ask for the nearest.`,candidates:matches};
  if(!matches.length){
    if(/\b(bench|cup\s?cake|pyramid|volcano|monolith|spire|arch|lantern|waystone)\b/i.test(request))return {error:'I cannot find that object in this world. Ask about a registered object or point at a target.',candidates:[]};
    return {candidates:[]};
  }
  const object=matches[0];
  let interaction:WorldInteraction|undefined;
  if(/\bsit\b/i.test(request))interaction='sit';else if(interact)interaction='toggle';else if(/\bread\b/i.test(request))interaction='read';
  if(interaction&&!object.actions.includes(interaction))return {error:`I can approach and inspect ${object.name}, but it does not support ${interaction}.`,candidates:matches};
  return {step:{action:interaction?'INTERACT_OBJECT':guide?'GUIDE_TO_OBJECT':inspect?'INSPECT_OBJECT':'GO_TO_OBJECT',targetId:object.id,...(interaction?{interaction}:{}),...(interaction==='toggle'&&/\b(on|off)\b/i.test(request)?{state:/\boff\b/i.test(request)?'off':'on'}:{})},candidates:matches};
}
