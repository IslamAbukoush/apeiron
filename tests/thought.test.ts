import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseThought} from '../server/thought';
import {Caretaker} from '../src/game/npc';
import {createWorld} from '../src/game/world';
import {Vector3} from 'three';
import {isActionRequest} from '../src/game/npc-contract';

test('questions mentioning landmarks do not become movement commands',()=>{
  for(const question of ['What is the waystone?','Why is the lantern dark?','Tell me about this place','Can you explain the inscription?']) assert.equal(isActionRequest(question),false);
  for(const command of ['Follow me','Please light the lantern','Can you show me the waystone?','Jump']) assert.equal(isActionRequest(command),true);
});

test('conversation answer persists through task execution and questions reject unsolicited plans',async()=>{
  const world=createWorld();
  let fastCalls=0;
  const npc=new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp,
    (async(url:string)=>{
      if(url.endsWith('/decision')){fastCalls++;return Response.json({action:'PATROL',reply:'WELCOME'});}
      return Response.json({speech:'The waystone marks the beginning of this courtyard.',plan:['INSPECT_WAYSTONE']});
    }) as typeof fetch);
  npc.setAI(true);npc.llmEnabled=true;
  const player=new Vector3(0,0,8);
  await npc.command('What is the waystone?',player);
  assert.equal(fastCalls,0);assert.equal(npc.action,'WAIT');
  const answer=npc.speech;
  for(let i=0;i<1800;i++)npc.step(1/60,player);
  assert.equal(npc.speech,answer);assert.equal(npc.action,'WAIT');
  npc.apply({action:'TEND_LANTERN',reply:'LANTERN'},player);
  for(let i=0;i<600;i++)npc.step(1/60,player);
  assert.equal(npc.speech,answer);assert.equal(world.lamp.get(),true);
  npc.dispose();world.dispose();
});

test('Gemini plans reject unsupported actions and excessive speech',()=>{
  assert.throws(()=>parseThought({speech:'Hello',plan:['RUN_CODE']}));
  assert.throws(()=>parseThought({speech:'x'.repeat(601),plan:[]}));
  assert.deepEqual(parseThought({speech:' Hello ',plan:['JUMP','WAIT']}),{speech:'Hello',plan:['JUMP','WAIT']});
});

test('late fast decision cannot overwrite thoughtful plan; reset cancels Gemini',async()=>{
  const world=createWorld();
  let finishFast!:(response:Response)=>void;
  let finishThought!:(response:Response)=>void;
  const npc=new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp,
    ((url:string)=>new Promise<Response>(resolve=>{if(url.endsWith('/thought'))finishThought=resolve;else finishFast=resolve;})) as typeof fetch);
  npc.setAI(true);npc.llmEnabled=true;
  const pending=npc.command('Tend the lantern',new Vector3(0,0,8));
  finishThought(Response.json({speech:'I will light the lantern.',plan:['TEND_LANTERN']}));
  await new Promise(resolve=>setTimeout(resolve,0));
  finishFast(Response.json({action:'WAIT',reply:'WAIT',remaining:4}));await pending;
  assert.equal(npc.action,'TEND_LANTERN');assert.equal(npc.speech,'I will light the lantern.');
  const stale=npc.command('Follow',new Vector3(0,0,8));npc.reset();
  finishThought(Response.json({speech:'Following',plan:['FOLLOW_PLAYER']}));
  finishFast(Response.json({action:'FOLLOW_PLAYER',reply:'FOLLOW'}));await stale;
  assert.equal(npc.action,'PATROL');assert.equal(npc.thinking,false);
  npc.dispose();world.dispose();
});
