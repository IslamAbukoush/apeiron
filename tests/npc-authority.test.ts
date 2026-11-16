import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {Caretaker} from '../src/game/npc';
import {createWorld} from '../src/game/world';
import {playerDirective} from '../src/game/npc-contract';

test('follow, come here and stop persist despite an unrelated LLM errand and enabled decision model',async()=>{
  const world=createWorld(),calls:string[]=[];
  const npc=new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp,(async url=>{
    calls.push(String(url));return Response.json({speech:'I will lead you to the waystone.',plan:['GUIDE_PLAYER']});
  }) as typeof fetch,world.registry);
  npc.setAI(true);npc.llmEnabled=true;
  const player=new Vector3(0,0,8);
  for(const request of ['Follow me','Come here','Please come to me','Stop','Stay here']){
    await npc.command(request,player);
    const expected=playerDirective(request)!;assert.equal(npc.action,expected);
    assert.doesNotMatch(npc.speech,/waystone/i);
    for(let i=0;i<500;i++)npc.step(.1,player);
    assert.equal(npc.action,expected);assert.doesNotMatch(npc.speech,/waystone/i);
  }
  assert.equal(calls.length,5);assert.ok(calls.every(url=>url.endsWith('/thought')));
  npc.dispose();world.dispose();
});

test('LLM plan overrides an earlier reflex, and a late reflex cannot override the LLM',async()=>{
  for(const thoughtFirst of [false,true]){
    const world=createWorld();let thought!:(r:Response)=>void,fast!:(r:Response)=>void;
    const npc=new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp,((url:string)=>new Promise<Response>(resolve=>{
      if(url.endsWith('/thought'))thought=resolve;else fast=resolve;
    })) as typeof fetch,world.registry);
    npc.setAI(true);npc.llmEnabled=true;
    const pending=npc.command('Patrol',new Vector3(0,0,8));
    const resolveThought=()=>thought(Response.json({speech:'I will inspect the bench first.',plan:[{action:'INSPECT_OBJECT',targetId:'bench'}]}));
    const resolveFast=()=>fast(Response.json({action:'GUIDE_PLAYER',reply:'GUIDE'}));
    (thoughtFirst?resolveThought:resolveFast)();await new Promise(resolve=>setTimeout(resolve,0));
    (thoughtFirst?resolveFast:resolveThought)();await pending;
    assert.equal(npc.action,'INSPECT_OBJECT');assert.equal(npc.targetId,'bench');assert.match(npc.source,/LLM/);
    npc.dispose();world.dispose();
  }
});

test('follow acknowledgement replaces an old errand immediately and survives an LLM outage',async()=>{
  const world=createWorld();let fail!:(e:Error)=>void;
  const npc=new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp,(()=>new Promise<Response>((_,reject)=>fail=reject)) as typeof fetch,world.registry);
  npc.llmEnabled=true;npc.say('I will lead you to the waystone.');
  const pending=npc.command('Come here',new Vector3(0,0,8));
  assert.equal(npc.action,'FOLLOW_PLAYER');assert.match(npc.speech,/I will follow you/);
  const version=npc.speechVersion;fail(Error('offline'));await pending;
  assert.equal(npc.action,'FOLLOW_PLAYER');assert.equal(npc.speechVersion,version);assert.match(npc.thoughtStatus,/offline/);
  npc.dispose();world.dispose();
});

test('idle LLM deliberation gets fresh state and cannot interrupt a newer follow command',async()=>{
  const world=createWorld();let finish!:(r:Response)=>void;const bodies:any[]=[];
  const npc=new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp,((_,init)=>{
    const body=JSON.parse(init!.body as string);bodies.push(body);
    return body.deliberate?new Promise<Response>(resolve=>finish=resolve):Promise.resolve(Response.json({speech:'Following.',plan:['FOLLOW_PLAYER']}));
  }) as typeof fetch,world.registry);
  npc.llmEnabled=true;const player=new Vector3(0,0,8);npc.step(5.1,player);
  assert.equal(bodies[0].deliberate,true);assert.ok(bodies[0].world.objects.length);assert.deepEqual(bodies[0].history,[]);
  await npc.command('Come here',player);
  finish(Response.json({speech:'I will lead you to the waystone.',plan:['GUIDE_PLAYER']}));
  await new Promise(resolve=>setTimeout(resolve,0));
  for(let i=0;i<400;i++)npc.step(.1,player);
  assert.equal(npc.action,'FOLLOW_PLAYER');assert.equal(bodies.length,2);assert.doesNotMatch(npc.speech,/waystone/i);
  npc.dispose();world.dispose();
});

test('an idle LLM can choose and execute a world interaction instead of the decision model choice',async()=>{
  const world=createWorld();
  const npc=new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp,(async url=>Response.json(String(url).endsWith('/decision')?
    {action:'GUIDE_PLAYER',reply:'GUIDE'}:{speech:'The lantern is dark, so I will light it.',plan:[{action:'INTERACT_OBJECT',targetId:'lantern',interaction:'toggle',state:'on'}]})) as typeof fetch,world.registry);
  npc.setAI(true);npc.llmEnabled=true;const player=new Vector3(0,0,8);
  npc.step(5.1,player);await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(npc.action,'INTERACT_OBJECT');assert.equal(npc.targetId,'lantern');
  for(let i=0;i<300&&!world.lamp.get();i++)npc.step(.1,player);
  assert.equal(world.lamp.get(),true);assert.match(npc.source,/LLM/);
  npc.dispose();world.dispose();
});
