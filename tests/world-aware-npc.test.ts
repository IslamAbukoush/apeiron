import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,Box3} from 'three';
import {createWorld} from '../src/game/world';
import {createGeneratedWorld} from '../src/game/generated-world';
import {generateWorld} from '../src/game/generation';
import {Caretaker} from '../src/game/npc';
import {Navigation} from '../src/game/navigation';
import {findObjects,resolveObjectRequest} from '../src/game/world-contract';
import {parsePlan} from '../src/game/npc-contract';
import {validateState} from '../server/decision';
import {validateWorld} from '../server/world-state';
import {validateView} from '../server/vision';

function setup(prompt?:string){
  const world=prompt?createGeneratedWorld(generateWorld(prompt,'object-tests')):createWorld();
  const npc=new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp,undefined,world.registry);
  return {world,npc};
}
function arrive(npc:Caretaker,world:ReturnType<typeof createWorld>,guide=false){
  const player=new Vector3(0,0,8),nav=new Navigation(world.navigationColliders,world.registry.limit);
  for(let frame=0;frame<1000&&npc.action!=='WAIT';frame++){
    if(guide)player.set(world.npc.position.x+2,0,world.npc.position.z+2);
    npc.step(.1,player);
    if(!npc.activity.startsWith('Sitting'))assert.ok(nav.walkable(world.npc.position),`collision during ${npc.activity}`);
  }
  assert.equal(npc.action,'WAIT',`failed arrival: ${npc.activity}`);
}

test('every generated theme registers its own landmark and supports guiding, inspection and real interactions',async()=>{
  for(const prompt of ['candy world','enchanted forest','desert','frozen world','volcanic world','cosmic world']){
    const {world,npc}=setup(prompt);const map=world.registry.snapshot();
    assert.ok(validateWorld(map));assert.ok(map.objects.some(object=>object.id==='bench'));
    const landmark=map.objects.find(object=>object.id==='landmark')!;
    await npc.command('Show me where is the '+landmark.name,new Vector3(0,0,8));
    assert.equal(npc.action,'GUIDE_TO_OBJECT',`${prompt}: ${npc.speech}`);arrive(npc,world,true);assert.ok(npc.visited.has('landmark'));assert.equal(npc.speech,'');
    await npc.command('Read the waystone',new Vector3(0,0,8));arrive(npc,world);assert.match(npc.execution!.detail,/Seed: object-tests/);assert.equal(npc.speech,'');
    await npc.command('Turn on the lantern',new Vector3(0,0,8));arrive(npc,world);assert.equal(world.lamp.get(),true);
    await npc.command('Turn on the lantern',new Vector3(0,0,8));arrive(npc,world);assert.equal(world.lamp.get(),true);
    await npc.command('Sit on the bench',new Vector3(0,0,8));arrive(npc,world);assert.match(npc.activity,/Sitting/);assert.equal(world.npc.scale.y,1);npc.step(.1,new Vector3(0,0,8));assert.equal(world.npc.userData.avatarAnimation,'sit');
    await npc.command('Follow me',new Vector3(0,0,8));assert.equal(world.npc.scale.y,1);assert.ok(new Navigation(world.navigationColliders,map.limit).walkable(world.npc.position));
    npc.dispose();world.dispose();
  }
});

test('names, aliases, nearest, pointing and ambiguous or missing destinations resolve safely',async()=>{
  const {world,npc}=setup('candy world');const map=world.registry.snapshot(),origin={x:0,z:8};
  assert.equal(resolveObjectRequest('show me the big cup cake',map,origin).step?.targetId,'landmark');
  assert.equal(findObjects('nearest lollipop',map.objects,origin).length,1);
  assert.ok(resolveObjectRequest('inspect a lollipop',map,origin).error);
  const object=map.objects.find(object=>object.kind==='lollipop')!;
  assert.equal(resolveObjectRequest('inspect that lollipop',map,origin,{...object.position,y:2,name:object.name,ground:false,objectId:object.id}).step?.targetId,object.id);
  await npc.command('show me the pyramid',origin);assert.equal(npc.action,'WAIT');assert.match(npc.execution!.detail,/cannot find/i);assert.equal(npc.speech,'');
  await npc.command('sit on the cupcake',origin);assert.equal(npc.action,'WAIT');assert.match(npc.execution!.detail,/does not support sit/);assert.equal(npc.speech,'');
  npc.dispose();world.dispose();
});

test('navigation and request validation use generated world bounds beyond the original courtyard',async()=>{
  const {world,npc}=setup('candy world');const map=world.registry.snapshot();
  const object=map.objects.find(object=>Math.abs(object.position.x)>21||Math.abs(object.position.z)>21)!;
  await npc.command('Go to that',new Vector3(0,0,8),{target:{...object.position,y:1,name:object.name,ground:false,objectId:object.id}});
  assert.equal(npc.action,'GO_TO_OBJECT');arrive(npc,world);assert.ok(Math.abs(world.npc.position.x)>19.5||Math.abs(world.npc.position.z)>19.5);
  const state=npc.snapshot({x:28,z:0},'Hello');assert.ok(validateState(state));assert.equal(validateView({target:{x:28,y:0,z:0,name:'ground',ground:true}},map.limit).target?.x,28);
  assert.throws(()=>validateState({...state,player:{x:30,z:0}}));
  npc.dispose();world.dispose();
});

test('guiding waits for a distant player and an enclosed object cannot execute its interaction',async()=>{
  const {world,npc}=setup();await npc.command('Show me the bench',{x:0,z:15});const start=world.npc.position.clone();npc.step(1,new Vector3(0,0,15));assert.ok(start.equals(world.npc.position));assert.match(npc.activity,/catch up/);
  npc.dispose();world.dispose();
  const trapped=setup();const obstacles=[...trapped.world.navigationColliders,new Box3(new Vector3(4,0,-3),new Vector3(10,3,3))];
  const blocked=new Caretaker(trapped.world.npc,trapped.world.npcCollider,obstacles,trapped.world.lamp,undefined,trapped.world.registry);
  await blocked.command('Sit on the bench',{x:0,z:8});assert.equal(blocked.action,'WAIT');assert.match(blocked.execution!.detail,/clear route/);assert.equal(blocked.speech,'');assert.equal(trapped.world.npc.scale.y,1);
  blocked.dispose();trapped.npc.dispose();trapped.world.dispose();
});

test('object plan validation requires a real target and explicit interaction',()=>{
  assert.throws(()=>parsePlan(['GUIDE_TO_OBJECT']));assert.throws(()=>parsePlan([{action:'INTERACT_OBJECT',targetId:'bench'}]));
  assert.deepEqual(parsePlan([{action:'GUIDE_TO_OBJECT',targetId:'landmark'}]),[{action:'GUIDE_TO_OBJECT',targetId:'landmark'}]);
});

test('switching worlds invalidates in-flight object plans and restores the current world registry',async()=>{
  const old=setup('candy world');let finish!:(response:Response)=>void;
  const npc=new Caretaker(old.world.npc,old.world.npcCollider,old.world.navigationColliders,old.world.lamp,(async()=>new Promise<Response>(resolve=>finish=resolve)) as typeof fetch,old.world.registry);
  npc.llmEnabled=true;const pending=npc.command('Visit the frosting monument',{x:0,z:8});npc.dispose();
  const next=setup('frozen world'),position=next.world.npc.position.clone();
  finish(Response.json({speech:'Walk to the cupcake.',plan:[{action:'GO_TO_OBJECT',targetId:'landmark'}],worldId:old.world.registry.id}));await pending;
  assert.ok(next.world.npc.position.equals(position));assert.equal(next.npc.snapshot({x:0,z:8}).world!.name,'Frostglass Reach');assert.equal(next.npc.thinking,false);
  old.npc.dispose();old.world.dispose();next.npc.dispose();next.world.dispose();
});
