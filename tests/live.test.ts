import {test} from 'node:test';
import assert from 'node:assert/strict';
import {liveThought,validateLiveReply} from '../server/live';
import {caretakerInstruction} from '../server/npc-instructions';

test('Live plan validates executable actions',()=>{
  assert.throws(()=>validateLiveReply({speech:'Hello',plan:['EXECUTE_CODE']}));
  assert.deepEqual(validateLiveReply({speech:'Hello',plan:[]}),{speech:'Hello',plan:[]});
});

test('Live scene question sends screenshot and shared visual instructions for a nonground target',async()=>{
  const sent:Record<string,any>[]=[];
  const request='What do you see here?';
  const image='data:image/jpeg;base64,'+Buffer.from([255,216,255,217]).toString('base64');
  const fake={onopen:null,onmessage:null,onerror:null,onclose:null,close(){},
    send(raw:string){
      const message=JSON.parse(raw);sent.push(message);
      if(message.setup)emit({setupComplete:{}});
      if(message.clientContent)emit({serverContent:{outputTranscription:{text:'I see a courtyard and a lantern.'},modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:'AAAAAA=='}}]},turnComplete:true}});
    },
  };
  const emit=(data:unknown)=>queueMicrotask(()=>{void (fake.onmessage as unknown as (event:unknown)=>void)?.({data:JSON.stringify(data)});});
  const result=await liveThought({apiKey:'server-only-key',model:'gemini-3.8-live',instruction:caretakerInstruction(request),
    state:{npc:{x:0,z:-2,action:'WAIT',visited:[]},player:{x:0,z:8},lanternOn:false,request},history:[],view:{image,target:{x:0,y:1.65,z:-2,name:'The caretaker',ground:false}},
    connect:()=>{queueMicrotask(()=>{(fake.onopen as unknown as ()=>void)?.();});return fake as unknown as WebSocket;}});
  assert.match(sent[0].setup.systemInstruction.parts[0].text,/This turn is conversation, not a movement command/);
  assert.match(sent[0].setup.systemInstruction.parts[0].text,/Never ask the player to point at clear ground to answer a visual question/);
  assert.equal(sent[1].clientContent.turns[0].parts[1].inlineData.data,image.split(',')[1]);
  assert.equal(sent.some(message=>message.realtimeInput),false);
  assert.match(sent[1].clientContent.turns[0].parts[0].text,/"ground":false/);
  assert.deepEqual(result.plan,[]);
  assert.equal(sent[0].setup.tools,undefined);
  assert.equal(sent.length,2);
  assert.equal(result.speech,'I see a courtyard and a lantern.');
});
test('Live tool response and native audio share a turn; initial tool completion does not drop voice',async()=>{
  const sent:Record<string,any>[]=[];
  let closed=false;const streamed:string[]=[];let earlyReply=false;
  const fake={onopen:null,onmessage:null,onerror:null,onclose:null,
    close(){closed=true;},
    send(raw:string){
      const message=JSON.parse(raw);sent.push(message);
      if(message.setup)emit({setupComplete:{}});
      if(message.clientContent)emit({toolCall:{functionCalls:[{name:'reply_to_player',id:'1',args:{speech:'Follow me.',plan:['FOLLOW_PLAYER']}}]},serverContent:{turnComplete:true}});
      if(message.toolResponse)emit({serverContent:{modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:Buffer.from([0,0,1,0]).toString('base64')}}]},turnComplete:true}});
    },
  };
  const emit=(data:unknown)=>queueMicrotask(()=>{void (fake.onmessage as unknown as (event:unknown)=>void)?.({data:JSON.stringify(data)});});
  const result=await liveThought({apiKey:'server-secret',model:'gemini-2.5-flash-native-audio-latest',instruction:'',
    state:{npc:{x:0,z:0,action:'WAIT',visited:[]},player:{x:0,z:8},request:'Follow me',lanternOn:false},history:[],view:{},
    onReply:()=>{earlyReply=true;assert.equal(closed,false);},onAudio:chunk=>{streamed.push(chunk);assert.equal(closed,false);},
    connect:()=>{queueMicrotask(()=>{(fake.onopen as unknown as ()=>void)?.();});return fake as unknown as WebSocket;}});
  assert.equal(result.speech,'Follow me.');assert.deepEqual(result.plan,['FOLLOW_PLAYER']);
  assert.match(result.audio!,/^data:audio\/wav;base64,/);assert.ok(closed);
  assert.equal(sent.length,3);assert.equal(sent[0].setup.generationConfig.responseModalities[0],'AUDIO');
  assert.equal(earlyReply,true);assert.equal(streamed.length,1);
  assert.equal(sent[0].setup.tools[0].functionDeclarations[0].behavior,'NON_BLOCKING');
});
