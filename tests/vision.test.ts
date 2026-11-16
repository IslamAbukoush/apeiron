import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateView} from '../server/vision';
import {pcmToWav} from '../server/tts';
import {Caretaker} from '../src/game/npc';
import {createWorld} from '../src/game/world';
import {Vector3} from 'three';

test('visual context rejects bad images and coordinates; raised surfaces are not ground',()=>{
  assert.throws(()=>validateView({image:'data:image/jpeg;base64,not-an-image'}));
  assert.throws(()=>validateView({target:{x:Infinity,y:0,z:0,name:'floor',ground:true}}));
  assert.equal(validateView({target:{x:2,y:2,z:2,name:'crate',ground:true}}).target?.ground,false);
});
test('Google PCM is wrapped as mono 24 kHz 16-bit WAV',()=>{
  const wav=pcmToWav(Buffer.from([0,0,1,0]));
  assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt32LE(24),24000);
  assert.equal(wav.readUInt32LE(40),4);assert.equal(wav.length,48);
});
test('pointed movement arrives and stays; invalid targets do not move the caretaker',async()=>{
  const world=createWorld(),npc=new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp);
  const player=new Vector3(0,0,8);
  await npc.command('Stand there',player,{target:{x:3,y:0,z:-5,name:'ground',ground:true}});
  assert.equal(npc.action,'MOVE_TO_TARGET');
  for(let i=0;i<1200;i++)npc.step(1/60,player);
  assert.equal(npc.action,'WAIT');assert.ok(Math.hypot(world.npc.position.x-3,world.npc.position.z+5)<.1);
  const before=world.npc.position.clone();
  await npc.command('Stand there',player,{target:{x:0,y:4,z:0,name:'arch',ground:false}});
  for(let i=0;i<120;i++)npc.step(1/60,player);
  assert.ok(before.equals(world.npc.position));
  npc.dispose();world.dispose();
});
