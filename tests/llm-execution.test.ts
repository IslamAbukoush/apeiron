import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Box3,Vector3} from 'three';
import {createWorld} from '../src/game/world';
import {Caretaker} from '../src/game/npc';
import {canPlanActions,isActionRequest} from '../src/game/npc-contract';
import {validateState} from '../server/decision';

test('LLM repeats a jump from execution context without a decision service or keyword replay',async()=>{
  const world=createWorld(),player=new Vector3(0,0,8),requests:any[]=[];
  const npc=new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp,(async(url,init)=>{
    assert.ok(String(url).endsWith('/thought'));const body=JSON.parse(init!.body as string);requests.push(body);
    return Response.json({speech:'I will jump again.',plan:['JUMP'],provider:'groq'});
  }) as typeof fetch,world.registry);
  npc.setAI(true);npc.llmEnabled=true;await npc.command('Jump',player);
  for(let i=0;i<8;i++)npc.step(.1,player);
  assert.equal(npc.execution?.status,'completed');assert.equal(npc.execution?.step,'JUMP');
  await npc.command('Do it again',player);
  assert.equal(requests.at(-1).npc.execution.step,'JUMP');assert.equal(requests.at(-1).npc.execution.status,'completed');
  npc.step(.1,player);assert.ok(world.npc.position.y>.1,'LLM plan must cause a real second jump');
  assert.equal(npc.execution?.step,'JUMP');assert.equal(npc.execution?.status,'running');
  npc.dispose();world.dispose();
});

test('late LLM acknowledgement does not repeat a reflex jump in the same turn',async()=>{
  const world=createWorld(),player=new Vector3(0,0,8);let finish!:(r:Response)=>void;
  const npc=new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp,(()=>new Promise<Response>(resolve=>finish=resolve)) as typeof fetch,world.registry);
  npc.llmEnabled=true;const pending=npc.command('Jump',player);for(let i=0;i<8;i++)npc.step(.1,player);
  finish(Response.json({speech:'Jumping.',plan:['JUMP']}));await pending;npc.step(.1,player);
  assert.equal(world.npc.position.y,0);assert.equal(npc.execution?.status,'completed');npc.dispose();world.dispose();
});

test('toggle is executable, movement happens before interaction, and completion speech follows engine success',async()=>{
  const world=createWorld(),player=new Vector3(0,0,8),initial=world.npc.position.clone();
  const npc=new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp,(async()=>Response.json({speech:'I toggled the lantern on.',plan:[]})) as typeof fetch,world.registry);
  npc.llmEnabled=true;assert.equal(isActionRequest('Toggle the lantern on'),true);
  await npc.command('Toggle the lantern on',player);assert.equal(npc.action,'INTERACT_OBJECT');assert.equal(world.lamp.get(),false);assert.equal(npc.execution?.status,'running');assert.doesNotMatch(npc.speech,/I toggled/);
  for(let i=0;i<400&&npc.action!=='WAIT';i++)npc.step(.1,player);
  assert.ok(world.npc.position.distanceTo(initial)>1);assert.equal(world.lamp.get(),true);assert.equal(npc.execution?.status,'completed');assert.match(npc.speech,/lit|on/i);
  assert.equal(validateState(npc.snapshot(player)).npc.execution?.status,'completed');npc.dispose();world.dispose();
});

test('an indirect LLM action executes and a blocked route cannot be covered up by a success claim',async()=>{
  for(const blocked of [false,true]){
    const world=createWorld(),player=new Vector3(0,0,8);
    const obstacles=[...world.navigationColliders,...(blocked?[new Box3(new Vector3(-5,0,0),new Vector3(0,3,6))]:[])];
    const npc=new Caretaker(world.npc,world.npcCollider,obstacles,world.lamp,(async()=>Response.json({speech:'I have turned it on.',plan:[{action:'INTERACT_OBJECT',targetId:'lantern',interaction:'toggle',state:'on'}]})) as typeof fetch,world.registry);
    npc.llmEnabled=true;await npc.command('It is too dark; a little light would help',player);
    if(blocked){assert.equal(npc.action,'WAIT');assert.equal(npc.execution?.status,'blocked');assert.match(npc.speech,/clear route/);assert.equal(world.lamp.get(),false);}
    else{assert.equal(npc.action,'INTERACT_OBJECT');for(let i=0;i<400&&npc.action!=='WAIT';i++)npc.step(.1,player);assert.equal(world.lamp.get(),true);}
    npc.dispose();world.dispose();
  }
  assert.equal(canPlanActions('Do it again'),true);assert.equal(canPlanActions('Why is the lantern dark?'),false);
});

test('a speech-only action promise is reported as not started instead of pretending to execute',async()=>{
  const world=createWorld();const npc=new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp,(async()=>Response.json({speech:'I will do it again.',plan:[]})) as typeof fetch,world.registry);
  npc.llmEnabled=true;await npc.command('Do it again',{x:0,z:8});assert.match(npc.speech,/not started an action/);assert.equal(npc.action,'WAIT');npc.dispose();world.dispose();
});
