import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createTtsMiddleware,pcmToWav} from '../server/tts';
import {createThoughtMiddleware} from '../server/thought';

test('local speech needs no Google key and never falls back to a cloud request',async()=>{
  let calls=0;
  const middleware=createTtsMiddleware({local:{status:()=>({provider:'local',model:'Paradee-8M-v1.3',voice:'am_puck',configured:true,ready:true}),synthesize:async text=>{
    calls++;assert.equal(text,'Hello, traveler.');return {wav:pcmToWav(Buffer.from([0,0,1,0])),latencyMs:42,durationMs:1};
  }},fetcher:(async()=>{throw Error('Cloud TTS must not run');}) as typeof fetch});
  const server=createServer((req,res)=>{void middleware(req,res,()=>res.end());});server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try{
    assert.equal((await(await fetch(url+'/api/npc/tts/status')).json()).provider,'local');
    const response=await fetch(url+'/api/npc/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'Hello, traveler.'})});
    assert.equal(response.status,200);assert.equal(response.headers.get('X-Synthesis-Ms'),'42');
    assert.equal(response.headers.get('X-NPC-Voice-Provider'),'local');
    assert.equal(Buffer.from(await response.arrayBuffer()).toString('ascii',0,4),'RIFF');
    const invalid=await fetch(url+'/api/npc/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'x'.repeat(601)})});
    assert.equal(invalid.status,400);assert.equal(calls,1);
    const crossOrigin=await fetch(url+'/api/npc/tts',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://other.example'},body:JSON.stringify({text:'Hello, traveler.'})});
    assert.equal(crossOrigin.status,403);assert.equal(calls,1);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('voice-enabled conversation with local speech uses the fast text model and preserves vision',async()=>{
  const image=Buffer.from([255,216,255,217]).toString('base64');
  const middleware=createThoughtMiddleware({apiKey:'server-only-key',localVoice:true,fetcher:(async(url,init)=>{
    assert.match(String(url),/gemini-3\.5-flash-lite:generateContent$/);
    const body=JSON.parse(init?.body as string);
    assert.equal(body.contents[0].parts[1].inlineData.data,image);
    assert.equal(body.generationConfig.responseModalities,undefined);
    return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({speech:'I see a lantern.',plan:[]})}]}}]});
  }) as typeof fetch});
  const server=createServer((req,res)=>{void middleware(req,res,()=>res.end());});server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const response=await fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/api/npc/thought`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({voice:true,npc:{x:0,z:-2,action:'WAIT',visited:[]},player:{x:0,z:8},lanternOn:false,request:'What do you see here?',view:{image:'data:image/jpeg;base64,'+image}})});
    assert.equal(response.status,200);assert.match(response.headers.get('Content-Type')!,/application\/json/);
    assert.equal(response.headers.get('X-NPC-Vision'),'received');
    const reply=await response.json();assert.equal(reply.speech,'I see a lantern.');assert.equal(reply.audio,undefined);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
