import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseThought} from '../server/thought';
import {Caretaker} from '../src/game/npc';
import {createWorld} from '../src/game/world';
import {Vector3} from 'three';
import {isActionRequest} from '../src/game/npc-contract';

test('streaming publishes reply and audio before completion without replaying the action',async()=>{
  const world=createWorld();let stream!:ReadableStreamDefaultController<Uint8Array>;
  const response=new ReadableStream<Uint8Array>({start(controller){stream=controller;}});
  const npc=new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp,
    (async()=>new Response(response,{headers:{'Content-Type':'application/x-ndjson'}})) as typeof fetch);
  npc.llmEnabled=true;const chunks:string[]=[];npc.onAudioChunk=chunk=>chunks.push(chunk);
  const pending=npc.command('Follow me',new Vector3(0,0,8));
  const emit=(type:string,data:unknown)=>stream.enqueue(new TextEncoder().encode(JSON.stringify({type,data})+'\n'));
  emit('reply',{speech:'I will follow you.',plan:['FOLLOW_PLAYER']});emit('audio','AAAAAA==');
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.match(npc.speech,/I will follow you/);assert.equal(npc.thinking,true);assert.equal(npc.replyStreamed,true);
  assert.deepEqual(chunks,['AAAAAA==']);
  const version=npc.speechVersion;
  emit('done',{speech:'I will follow you.',plan:['FOLLOW_PLAYER'],model:'live',latencyMs:2000});stream.close();await pending;
  assert.equal(npc.speechVersion,version);assert.equal(npc.thinking,false);
  npc.dispose();world.dispose();
});

test('questions mentioning landmarks do not become movement commands',()=>{
  for(const question of ['What is the waystone?','Why is the lantern dark?','Tell me about this place','Can you explain the inscription?']) assert.equal(isActionRequest(question),false);
  for(const command of ['Follow me','Please light the lantern','Can you show me the waystone?','Jump']) assert.equal(isActionRequest(command),true);
});

test('local text streaming commits a final reply for separate local TTS',async()=>{
  const world=createWorld();let stream!:ReadableStreamDefaultController<Uint8Array>;
  const response=new ReadableStream<Uint8Array>({start(controller){stream=controller;}});
  const npc=new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp,
    (async()=>new Response(response,{headers:{'Content-Type':'application/x-ndjson','X-NPC-Audio':'none'}})) as typeof fetch);
  npc.llmEnabled=true;const pending=npc.command('What is this?',new Vector3(0,0,8));
  const emit=(type:string,data:unknown)=>stream.enqueue(new TextEncoder().encode(JSON.stringify({type,data})+'\n'));
  emit('text','A lantern.');await new Promise(resolve=>setTimeout(resolve,0));
  const version=npc.speechVersion;assert.equal(npc.replyStreamed,false);
  emit('done',{speech:'A lantern.',plan:[],provider:'local',latencyMs:500});stream.close();await pending;
  assert.equal(npc.speechVersion,version+1);assert.equal(npc.replyStreamed,false);
  npc.dispose();world.dispose();
});

test('conversation transcript reaches chat before final audio completion',async()=>{
  const world=createWorld();let stream!:ReadableStreamDefaultController<Uint8Array>;
  const response=new ReadableStream<Uint8Array>({start(controller){stream=controller;}});
  const npc=new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp,
    (async()=>new Response(response,{headers:{'Content-Type':'application/x-ndjson'}})) as typeof fetch);
  npc.llmEnabled=true;const transcripts:string[]=[];npc.onSpeechChunk=text=>transcripts.push(text);
  const pending=npc.command('What do you see here?',new Vector3(0,0,8));
  const emit=(type:string,data:unknown)=>stream.enqueue(new TextEncoder().encode(JSON.stringify({type,data})+'\n'));
  emit('text','I see ');emit('text','trees.');
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(transcripts,['I see ','I see trees.']);assert.equal(npc.thinking,true);
  emit('done',{speech:'I see trees.',plan:[],latencyMs:5000});stream.close();await pending;
  assert.equal(npc.speech,'I see trees.');assert.equal(npc.action,'WAIT');assert.equal(npc.thinking,false);
  npc.dispose();world.dispose();
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
