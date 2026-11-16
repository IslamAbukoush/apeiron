import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createLocalThoughtMiddleware} from '../server/local-thought';

const state={npc:{x:0,z:-2,action:'WAIT',visited:[]},player:{x:0,z:8},lanternOn:false,request:'What do you see here?'};
async function serve(middleware:ReturnType<typeof createLocalThoughtMiddleware>,run:(url:string)=>Promise<void>){
  const server=createServer((req,res)=>{void middleware(req,res,()=>{res.writeHead(404);res.end();});});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{await run(`http://127.0.0.1:${(server.address() as {port:number}).port}`);}
  finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
test('local vision streams text without a key, preserves images and stays on loopback',async()=>{
  const jpeg=Buffer.from([255,216,255,217]).toString('base64');
  let finish!:()=>void;const gate=new Promise<void>(resolve=>finish=resolve);
  const middleware=createLocalThoughtMiddleware({fetcher:(async(url,init)=>{
    assert.equal(url,'http://127.0.0.1:11435/api/chat');
    const body=JSON.parse(init?.body as string);assert.equal(body.think,false);assert.equal(body.options.num_ctx,4096);
    assert.equal(body.messages.at(-1).images[0],jpeg);assert.equal(body.stream,true);assert.equal(body.format,undefined);
    return new Response(new ReadableStream({start(controller){
      const bytes=new TextEncoder().encode(JSON.stringify({message:{content:'I see trees.'},done:false})+'\n');
      controller.enqueue(bytes.slice(0,12));controller.enqueue(bytes.slice(12));
      void gate.then(()=>{controller.enqueue(new TextEncoder().encode(JSON.stringify({done:true})));controller.close();});
    }}));
  }) as typeof fetch});
  await serve(middleware,async url=>{
    const response=await fetch(url+'/api/npc/thought',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({...state,voice:true,view:{image:'data:image/jpeg;base64,'+jpeg}})});
    assert.equal(response.status,200);assert.equal(response.headers.get('X-NPC-Vision'),'received');assert.equal(response.headers.get('X-NPC-Audio'),'none');
    const reader=response.body!.getReader();let text=new TextDecoder().decode((await reader.read()).value);
    assert.match(text,/I see trees/);assert.doesNotMatch(text,/"done"/);finish();
    while(true){const next=await reader.read();if(next.done)break;text+=new TextDecoder().decode(next.value);}
    const events=text.trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(events.at(-1).type,'done');assert.deepEqual(events.at(-1).data.plan,[]);
    assert.equal(events.at(-1).data.provider,'local');
  });
});
test('local commands use constrained actions and malformed states never reach the model',async()=>{
  let calls=0;
  const middleware=createLocalThoughtMiddleware({fetcher:(async(_url,init)=>{
    calls++;const body=JSON.parse(init?.body as string);assert.equal(body.stream,false);
    assert.ok(body.format.properties.plan.items.enum.includes('FOLLOW_PLAYER'));
    return Response.json({message:{content:JSON.stringify({speech:'I will follow you.',plan:['FOLLOW_PLAYER']})}});
  }) as typeof fetch});
  await serve(middleware,async url=>{
    const response=await fetch(url+'/api/npc/thought',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...state,request:'Follow me'})});
    assert.equal(response.status,200);assert.deepEqual((await response.json()).plan,['FOLLOW_PLAYER']);
    const invalid=await fetch(url+'/api/npc/thought',{method:'POST',body:JSON.stringify({...state,player:{x:100,z:0}})});
    assert.equal(invalid.status,400);assert.equal(calls,1);
    const foreign=await fetch(url+'/api/npc/thought',{method:'POST',headers:{Origin:'https://other.example'},body:JSON.stringify(state)});
    assert.equal(foreign.status,403);assert.equal(calls,1);
  });
});
test('unavailable local runtime reports an error without calling a cloud provider',async()=>{
  const middleware=createLocalThoughtMiddleware({fetcher:(async url=>{assert.match(String(url),/^http:\/\/127\.0\.0\.1:/);throw Error('offline');}) as typeof fetch});
  await serve(middleware,async url=>{
    const response=await fetch(url+'/api/npc/thought',{method:'POST',body:JSON.stringify(state)});
    assert.equal(response.status,503);assert.match((await response.json()).error,/Local LLM unavailable/);
  });
});

test('direct follow commands exclude old errands from history and constrain the model to follow',async()=>{
  const middleware=createLocalThoughtMiddleware({fetcher:(async(_,init)=>{
    const body=JSON.parse(init!.body as string);
    assert.deepEqual(body.format.properties.plan.items.enum,['FOLLOW_PLAYER']);
    assert.equal(body.messages.length,2);assert.doesNotMatch(JSON.stringify(body.messages),/Old errand/);
    return Response.json({message:{content:JSON.stringify({speech:'Keep going; I am right behind you.',plan:['FOLLOW_PLAYER']})}});
  }) as typeof fetch});
  await serve(middleware,async url=>{
    const r=await fetch(url+'/api/npc/thought',{method:'POST',body:JSON.stringify({...state,request:'Come here',history:['Caretaker: Old errand: go to the waystone.']})});
    assert.equal(r.status,200);const reply=await r.json();assert.deepEqual(reply.plan,['FOLLOW_PLAYER']);assert.equal(reply.speech,'Keep going; I am right behind you.');
  });
});

test('idle deliberation uses executable plans rather than plain conversation',async()=>{
  const middleware=createLocalThoughtMiddleware({fetcher:(async(_,init)=>{
    const body=JSON.parse(init!.body as string);assert.equal(body.stream,false);
    assert.match(body.messages[0].content,/choosing an activity while idle/);
    assert.match(body.messages.at(-1).content,/visited/);
    return Response.json({message:{content:JSON.stringify({speech:'I will wait.',plan:['WAIT']})}});
  }) as typeof fetch});
  await serve(middleware,async url=>{
    const r=await fetch(url+'/api/npc/thought',{method:'POST',body:JSON.stringify({...state,request:'Choose a useful activity.',deliberate:true})});
    assert.equal(r.status,200);assert.deepEqual((await r.json()).plan,['WAIT']);
  });
});
