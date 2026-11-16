import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {LocalVision,needsVisualContext} from '../server/local-vision';
import {createGroqThoughtMiddleware} from '../server/groq-thought';
const image='data:image/jpeg;base64,/9j/2Q==';
const state={npc:{x:0,z:-2,action:'WAIT',visited:[]},player:{x:0,z:8},lanternOn:false,request:'What do you see here?',view:{image}};
async function serve(middleware:ReturnType<typeof createGroqThoughtMiddleware>,run:(url:string)=>Promise<void>){
  const server=createServer((req,res)=>void middleware(req,res,()=>res.end()));server.listen(0,'127.0.0.1');await once(server,'listening');
  try{await run(`http://127.0.0.1:${(server.address() as any).port}`);}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
test('local vision sends pixels only to loopback, caches identical frames briefly, and honors cancellation',async()=>{
  let calls=0;
  const vision=new LocalVision({fetcher:(async(url,init)=>{
    calls++;assert.equal(url,'http://127.0.0.1:11435/api/chat');const body=JSON.parse(init!.body as string);
    assert.equal(body.messages[0].images[0],'/9j/2Q==');assert.equal(body.options.num_ctx,2048);assert.equal(body.think,false);
    return Response.json({message:{content:'A bench sits beside the path.'},done:true});
  }) as typeof fetch});
  const first=await vision.describe(image);assert.equal(first.cached,false);
  assert.equal((await vision.describe(image)).cached,true);assert.equal(calls,1);
  const cancelled=new AbortController();cancelled.abort();await assert.rejects(vision.describe(image,cancelled.signal),/Cancelled/);
  assert.equal(needsVisualContext('What do you see here?'),true);assert.equal(needsVisualContext('Tell me about yourself'),false);
});
test('hybrid sends only a local observation to Groq and skips vision for ordinary chat and direct follow',async()=>{
  let visionCalls=0,apiCalls=0;
  const vision=new LocalVision({fetcher:(async()=>{visionCalls++;return Response.json({message:{content:'A red bench is on the right.'},done:true});}) as typeof fetch});
  const middleware=createGroqThoughtMiddleware({apiKey:'test',vision,fetcher:(async(_,init)=>{
    apiCalls++;const body=JSON.parse(init!.body as string),serialized=JSON.stringify(body);
    assert.doesNotMatch(serialized,/image_url|base64|\/9j\/2Q==/);
    assert.match(serialized,apiCalls===1?/A red bench is on the right/:/Not requested for this turn/);
    if(body.response_format)return Response.json({choices:[{message:{content:JSON.stringify({speech:'Right behind you.',plan:['FOLLOW_PLAYER']})}}]});
    return new Response('data: '+JSON.stringify({choices:[{delta:{content:'There is a red bench on the right.'}}],usage:{total_tokens:700}})+'\n\ndata: [DONE]\n\n');
  }) as typeof fetch});
  await serve(middleware,async url=>{
    const send=(request:string)=>fetch(url+'/api/npc/thought',{method:'POST',body:JSON.stringify({...state,request})});
    const r=await send(state.request);assert.equal(r.headers.get('X-NPC-Vision-Source'),'local');const reply=await r.json();assert.equal(reply.perception.used,true);assert.match(reply.perception.description,/red bench/);
    const textOnly=await(await send('Tell me about yourself')).json();assert.equal(textOnly.perception.used,false);assert.equal(visionCalls,1);
    await send('Follow me');assert.equal(apiCalls,3);assert.equal(visionCalls,1);
    const status=await(await fetch(url+'/api/npc/thought/status')).json();assert.equal(status.mode,'hybrid');assert.equal(status.visionModel,vision.model);
  });
});
test('a local vision failure is explicit, with no automatic image upload to the API',async()=>{
  const vision=new LocalVision({fetcher:(async()=>{throw Error('offline');}) as typeof fetch});
  const middleware=createGroqThoughtMiddleware({apiKey:'test',vision,fetcher:(async(_,init)=>{
    const text=init!.body as string;assert.doesNotMatch(text,/base64|image_url/);assert.match(text,/Local vision unavailable/);
    return new Response('data: '+JSON.stringify({choices:[{delta:{content:'I could not inspect the screenshot.'}}]})+'\n\ndata: [DONE]\n\n');
  }) as typeof fetch});
  await serve(middleware,async url=>{
    const r=await fetch(url+'/api/npc/thought',{method:'POST',body:JSON.stringify(state)});assert.equal(r.headers.get('X-NPC-Vision-Source'),'local-error');
    const reply=await r.json();assert.match(reply.perception.error,/stayed local|sent to Groq/);assert.match(reply.speech,/could not inspect/);
  });
});
