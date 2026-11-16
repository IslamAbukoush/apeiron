import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {Caretaker} from '../src/game/npc';
import {createWorld} from '../src/game/world';
import {caretakerInstruction} from '../server/npc-instructions';
import {parseThought} from '../server/thought';
test('no scripted greeting, arrival, interaction or offline fallback is spoken',async()=>{
  const world=createWorld(),npc=new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp,undefined,world.registry),player=new Vector3(0,0,8);
  assert.equal(npc.speech,'');assert.equal(npc.speechVersion,0);
  for(const request of ['Go to the waystone','Turn on the lantern','Read the waystone','Who are you?']){
    await npc.command(request,player);for(let i=0;i<400&&npc.action!=='WAIT';i++)npc.step(.1,player);
    assert.equal(npc.speech,'');assert.equal(npc.speechVersion,0);
  }
  assert.equal(world.lamp.get(),true);npc.dispose();world.dispose();
});
test('model acknowledgement remains unchanged after arrival instead of being overwritten with an object label',async()=>{
  const world=createWorld(),player=new Vector3(0,0,8);let calls=0;
  const npc=new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp,(async()=>{calls++;return Response.json({speech:'That old stone? Sure, come along.',plan:[]});}) as typeof fetch,world.registry);
  npc.llmEnabled=true;await npc.command('Go to the waystone',player);const version=npc.speechVersion;
  for(let i=0;i<400&&npc.action!=='WAIT';i++)npc.step(.1,player);
  assert.equal(npc.speech,'That old stone? Sure, come along.');assert.equal(npc.speechVersion,version);assert.equal(calls,1);assert.ok(npc.visited.has('waystone'));npc.dispose();world.dispose();
});
test('requested reading sends engine facts back to the model for a generated answer without another action',async()=>{
  const world=createWorld(),player=new Vector3(0,0,8),requests:any[]=[];
  const npc=new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp,(async(_,init)=>{
    const input=JSON.parse(init!.body as string);requests.push(input);
    return Response.json(input.event?{speech:'It is a reminder to find your footing before rushing ahead.',plan:[]}:{speech:'Let me have a closer look.',plan:[]});
  }) as typeof fetch,world.registry);
  npc.llmEnabled=true;await npc.command('Read the waystone',player);
  for(let i=0;i<400&&npc.action!=='WAIT';i++)npc.step(.1,player);
  npc.step(.1,player);await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(requests.length,2);assert.equal(requests[1].event,'action_result');assert.equal(requests[1].npc.execution.status,'completed');assert.match(requests[1].npc.execution.detail,/place to stand/i);
  assert.equal(npc.speech,'It is a reminder to find your footing before rushing ahead.');assert.equal(npc.action,'WAIT');npc.dispose();world.dispose();
});
test('personality uses retrieved facts as data and does not prescribe canned utterances',()=>{
  const instruction=caretakerInstruction('Who are you?');assert.match(instruction,/Rowan/);assert.match(instruction,/warm|wry/);assert.match(instruction,/retrieved facts/);assert.match(instruction,/catchphrase/);
});
test('the model can choose a silent action without a fake acknowledgement or voice event',async()=>{
  assert.deepEqual(parseThought({speech:'',plan:['JUMP']}),{speech:'',plan:['JUMP']});
  const world=createWorld(),player=new Vector3(0,0,8);
  const npc=new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp,(async()=>Response.json({speech:'',plan:['JUMP']})) as typeof fetch,world.registry);
  npc.llmEnabled=true;await npc.command('Do a little hop',player);npc.step(.1,player);
  assert.ok(world.npc.position.y>.1);assert.equal(npc.speech,'');assert.equal(npc.speechVersion,0);npc.dispose();world.dispose();
});
