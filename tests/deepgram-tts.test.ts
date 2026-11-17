import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createTtsMiddleware,pcmToWav} from '../server/tts';
const wav=pcmToWav(Buffer.from([0,0,1,0]));
async function harness(options:Parameters<typeof createTtsMiddleware>[0],run:(url:string)=>Promise<void>){
  const middleware=createTtsMiddleware(options),server=createServer((req,res)=>{void middleware(req,res,()=>res.end());});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{await run(`http://127.0.0.1:${(server.address() as {port:number}).port}/api/npc/tts`);}
  finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
const post=(url:string,body:object)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const status=()=>({provider:'local',model:'Paradee',voice:'am_puck',configured:true,ready:true});
test('Deepgram is default with a key, selected voice reaches API and credentials stay private',async()=>{
  await harness({deepgramKey:'private-test-key',local:{status,synthesize:async()=>{throw Error('Unexpected fallback');}},fetcher:(async(url,init)=>{
    assert.match(String(url),/model=aura-2-thalia-en/);assert.match(String(url),/container=wav/);
    assert.equal(new Headers(init?.headers).get('Authorization'),'Token private-test-key');
    assert.deepEqual(JSON.parse(init?.body as string),{text:'Hello'});
    return new Response(wav,{headers:{'Content-Type':'audio/wav'}});
  }) as typeof fetch},async url=>{
    const info=await(await fetch(url+'/status')).text();assert.ok(!info.includes('private-test-key'));assert.equal(JSON.parse(info).defaultEngine,'deepgram');
    const r=await post(url,{text:'Hello',voice:'aura-2-thalia-en'});assert.equal(r.status,200);assert.equal(r.headers.get('x-npc-voice-provider'),'deepgram');assert.deepEqual(Buffer.from(await r.arrayBuffer()),wav);
  });
});
for(const failure of ['http','invalid','timeout','missing'] as const)test(`Deepgram ${failure} falls back to the chosen local voice`,async()=>{
  let localCalls=0;
  await harness({deepgramKey:failure==='missing'?undefined:'test',deepgramTimeoutMs:20,local:{status,synthesize:async(text,voice)=>{
    localCalls++;assert.equal(text,'Hello');assert.equal(voice,'bf_isabella');return {wav,latencyMs:2,durationMs:1};
  }},fetcher:(async(_url,init)=>{
    if(failure==='timeout')return await new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(Error('Timeout'))));
    return failure==='http'?new Response('limited',{status:429}):new Response('not audio');
  }) as typeof fetch},async url=>{
    const r=await post(url,{text:'Hello',engine:'deepgram',localVoice:'bf_isabella'});assert.equal(r.status,200);assert.equal(r.headers.get('x-npc-voice-provider'),'local');assert.ok(r.headers.get('x-npc-voice-fallback'));assert.equal(localCalls,1);
  });
});
test('explicit local mode never contacts Deepgram; invalid voices are rejected',async()=>{
  let calls=0;
  await harness({deepgramKey:'test',fetcher:(async()=>{throw Error('Must stay local');}) as typeof fetch,local:{status,synthesize:async(_text,voice)=>{calls++;assert.equal(voice,'af_heart');return {wav,latencyMs:1,durationMs:1};}}},async url=>{
    const r=await post(url,{text:'Hi',engine:'paradee',voice:'af_heart'});assert.equal(r.status,200);assert.equal(r.headers.get('x-npc-voice-fallback'),null);
    assert.equal((await post(url,{text:'Hi',engine:'deepgram',voice:'arbitrary-model'})).status,400);assert.equal(calls,1);
  });
});
test('disconnected clients cancel Deepgram without starting local synthesis',async()=>{
  let started!:()=>void;const begin=new Promise<void>(resolve=>started=resolve);let cancelled!:()=>void;const ended=new Promise<void>(resolve=>cancelled=resolve);let calls=0;
  await harness({deepgramKey:'test',local:{status,synthesize:async()=>{calls++;return {wav,latencyMs:1,durationMs:1};}},fetcher:(async(_url,init)=>{
    started();return await new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>{cancelled();reject(Error('Cancelled'));}));
  }) as typeof fetch},async url=>{
    const controller=new AbortController();const request=fetch(url,{method:'POST',body:JSON.stringify({text:'Hello'}),signal:controller.signal}).catch(()=>{});
    await begin;controller.abort();await request;await ended;await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);
  });
});

test('streaming forwards the first PCM chunk before synthesis finishes',async()=>{
  let finish!:()=>void;let upstreamCancelled=false;
  await harness({deepgramKey:'test',fetcher:(async(url)=>{
    assert.match(String(url),/container=none/);
    return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(4800));finish=()=>{controller.enqueue(new Uint8Array(4800));controller.close();};},cancel(){upstreamCancelled=true;}}),{headers:{'content-type':'audio/l16;rate=24000'}});
  }) as typeof fetch},async url=>{
    const r=await post(url,{text:'Hello',stream:true});assert.equal(r.headers.get('content-type'),'audio/pcm');
    const reader=r.body!.getReader();const first=await reader.read();assert.equal(first.value?.length,4800);assert.equal(first.done,false);
    finish();let total=first.value!.length;while(true){const part=await reader.read();if(part.done)break;total+=part.value.length;}
    assert.equal(total,9600);assert.equal(upstreamCancelled,false);
  });
});

test('streaming failures before first audio still use local WAV fallback',async()=>{
  await harness({deepgramKey:'test',fetcher:(async()=>new Response('limited',{status:429})) as typeof fetch,local:{status,synthesize:async()=>({wav,latencyMs:2,durationMs:1})}},async url=>{
    const r=await post(url,{text:'Hi',stream:true});assert.equal(r.headers.get('content-type'),'audio/wav');assert.equal(r.headers.get('x-npc-voice-fallback'),'http-429');
  });
});

test('a broken stream after playback starts does not replay the reply through fallback',async()=>{
  let fail!:()=>void,localCalls=0;
  await harness({deepgramKey:'test',fetcher:(async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(4800));fail=()=>controller.error(Error('Connection lost'));}}),{headers:{'content-type':'audio/l16'}})) as typeof fetch,local:{status,synthesize:async()=>{localCalls++;return {wav,latencyMs:2,durationMs:1};}}},async url=>{
    const r=await post(url,{text:'Hi',stream:true});const reader=r.body!.getReader();await reader.read();fail();await assert.rejects(reader.read());assert.equal(localCalls,0);
  });
});
