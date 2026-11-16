import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createGroqThoughtMiddleware} from '../server/groq-thought';
import {formatAiUsage,resetSeconds} from '../src/ui/ai-usage';
const state={npc:{x:0,z:-2,action:'WAIT',visited:[]},player:{x:0,z:8},lanternOn:false,request:'What do you see here?'};
async function serve(middleware:ReturnType<typeof createGroqThoughtMiddleware>,run:(url:string)=>Promise<void>){
  const server=createServer((req,res)=>void middleware(req,res,()=>res.end()));server.listen(0,'127.0.0.1');await once(server,'listening');
  try{await run(`http://127.0.0.1:${(server.address() as any).port}`);}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
const headers={'x-ratelimit-limit-requests':'1000','x-ratelimit-remaining-requests':'987','x-ratelimit-limit-tokens':'8000','x-ratelimit-remaining-tokens':'6000','x-ratelimit-reset-requests':'1m26.4s','x-ratelimit-reset-tokens':'15s'};
test('Groq streams vision replies, keeps credentials server-side, and exposes actual allowance without double counting usage',async()=>{
  const middleware=createGroqThoughtMiddleware({apiKey:'server-secret',fetcher:(async(url,init)=>{
    assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');assert.equal((init!.headers as any).Authorization,'Bearer server-secret');
    const body=JSON.parse(init!.body as string);assert.equal(body.reasoning_effort,'none');assert.equal(body.stream,true);
    assert.match(body.messages.at(-1).content[1].image_url.url,/^data:image\/jpeg;base64,/);
    const chunks=[{choices:[{delta:{content:'I see trees.'}}]},{choices:[],usage:{total_tokens:2000}},{choices:[],usage:{total_tokens:2000}}];
    return new Response(chunks.map(data=>'data: '+JSON.stringify(data)+'\n\n').join('')+'data: [DONE]\n\n',{headers});
  }) as typeof fetch});
  await serve(middleware,async url=>{
    const response=await fetch(url+'/api/npc/thought',{method:'POST',headers:{Accept:'application/x-ndjson'},body:JSON.stringify({...state,view:{image:'data:image/jpeg;base64,/9j/2Q=='}})});
    const text=await response.text();assert.equal(response.status,200);assert.match(text,/I see trees/);assert.doesNotMatch(text,/server-secret/);
    const result=JSON.parse(text.trim().split('\n').at(-1)!).data;assert.equal(result.usage.sessionTokens,2000);assert.equal(result.provider,'groq');
    const status=await(await fetch(url+'/api/npc/thought/status')).json();assert.equal(status.usage.requestsRemaining,987);assert.equal(status.usage.sessionRequests,1);assert.equal(status.configured,true);
  });
});
test('Groq rate limits remain visible for generated acknowledgements and malformed plans cannot execute',async()=>{
  let calls=0;
  const middleware=createGroqThoughtMiddleware({apiKey:'secret',fetcher:(async()=>{calls++;return Response.json({error:{message:'not exposed'}},{status:429,headers:{...headers,'retry-after':'12'}});}) as typeof fetch});
  await serve(middleware,async url=>{
    const send=(request:string)=>fetch(url+'/api/npc/thought',{method:'POST',body:JSON.stringify({...state,request})});
    const follow=await send('Come here');assert.equal(follow.status,429);assert.equal(calls,1);
    const limited=await send('Hello');assert.equal(limited.status,429);assert.match((await limited.json()).error,/rate limit/);
    const status=await(await fetch(url+'/api/npc/thought/status')).json();assert.equal(status.usage.lastStatus,429);assert.equal(status.usage.retryAfter,'12');
  });
  const malformed=createGroqThoughtMiddleware({apiKey:'secret',fetcher:(async()=>Response.json({choices:[{message:{content:'{"speech":"Oops","plan":["RUN_CODE"]}'}}]})) as typeof fetch});
  await serve(malformed,async url=>{const r=await fetch(url+'/api/npc/thought',{method:'POST',body:JSON.stringify({...state,request:'Jump'})});assert.equal(r.status,503);});
});
test('usage readout distinguishes unreported limits, snapshots, reset countdowns and rate limits',()=>{
  assert.equal(resetSeconds('1h2m3.5s'),3723.5);assert.equal(resetSeconds('500ms'),.5);
  assert.match(formatAiUsage({provider:'groq',configured:true}),/unknown/);
  assert.match(formatAiUsage({provider:'local',configured:true}),/no API quota/);
  const text=formatAiUsage({provider:'groq',configured:true,model:'test',usage:{updatedAt:1000,requestLimit:1000,requestsRemaining:987,tokenLimit:8000,tokensRemaining:0,tokensReset:'15s',requestsReset:'1m26.4s',lastStatus:429,retryAfter:'12',sessionRequests:1,sessionTokens:2000}},6000);
  assert.match(text,/987 \/ 1,000/);assert.match(text,/0m 10s/);assert.match(text,/Rate limit reached/);
  assert.match(formatAiUsage({provider:'groq',configured:true,usage:{updatedAt:1,tokensReset:'1s'}},20000),/awaiting next API report/);
});

test('contextual actions use a strict plan schema, structured history and engine receipts',async()=>{
  const middleware=createGroqThoughtMiddleware({apiKey:'secret',fetcher:(async(_,init)=>{
    const body=JSON.parse(init!.body as string);assert.equal(body.stream,false);assert.equal(body.response_format.type,'json_schema');assert.equal(body.response_format.json_schema.strict,true);
    const assistant=body.messages.find((message:any)=>message.role==='assistant');assert.equal(JSON.parse(assistant.content).speech,'Here goes a hop!');
    assert.match(body.messages.at(-1).content,/Jumped once/);
    return Response.json({choices:[{message:{content:JSON.stringify({speech:'Another hop.',plan:[{action:'JUMP',targetId:null,interaction:null,state:null}]})}}]});
  }) as typeof fetch});
  await serve(middleware,async url=>{
    const r=await fetch(url+'/api/npc/thought',{method:'POST',body:JSON.stringify({...state,request:'Do it again',history:['Player: Jump','Caretaker: Here goes a hop!'],npc:{...state.npc,execution:{step:'JUMP',status:'completed',detail:'Jumped once.'}}})});
    assert.equal(r.status,200);assert.deepEqual((await r.json()).plan,['JUMP']);
  });
});
