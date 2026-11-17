import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createCloudPool,retryDelay} from '../server/cloud-pool';
import {formatAiUsage} from '../src/ui/ai-usage';

const input={messages:[{role:'system',content:'Speak briefly.'},{role:'user',content:'Game context: {}\nPlayer request: Hello'}],stream:true};
const init=(body=input,signal?:AbortSignal)=>({method:'POST',body:JSON.stringify(body),signal});
const gemini=(text='Hello!')=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text}]}}],usageMetadata:{totalTokenCount:22}});
const groq=(text='Hello!')=>Response.json({choices:[{finish_reason:'stop',message:{content:text}}],usage:{total_tokens:30}});

test('Gemini models fail over in order, then Groq, and exhausted models are skipped until reset',async()=>{
  let clock=1000;const calls:string[]=[];
  const pool=createCloudPool({geminiKey:'private-g',groqKey:'private-q',geminiModels:['g1','g2'],groqModels:['openai/gpt-oss-20b'],now:()=>clock,fetcher:(async(url)=>{
    calls.push(String(url));return String(url).includes('googleapis')?Response.json({error:{message:'quota'}},{status:429,headers:{'retry-after':'60'}}):groq();
  }) as typeof fetch});
  assert.equal((await pool.transport('',init())).status,200);assert.equal(calls.length,3);
  assert.match(calls[0],/g1:/);assert.match(calls[1],/g2:/);assert.match(calls[2],/groq/);
  await pool.transport('',init());assert.equal(calls.length,4);assert.match(calls[3],/groq/);
  const status=pool.status();assert.equal(status.model,'openai/gpt-oss-20b');assert.equal(status.pool[0].state,'cooling');assert.equal(status.usage.sessionRequests,4);assert.equal(status.usage.sessionTokens,60);
  assert.doesNotMatch(JSON.stringify(status),/private-/);
  clock=62000;await pool.transport('',init());assert.equal(calls.length,7);
  assert.match(formatAiUsage(pool.status(),clock,true),/cooldown/);
});

test('server RetryInfo and HTTP date hints are honored',()=>{
  assert.equal(retryDelay(new Headers({'retry-after':'12'}),{},1000),12000);
  assert.equal(retryDelay(new Headers({'retry-after':'Thu, 01 Jan 1970 00:01:00 GMT'}),{},1000),59000);
  assert.equal(retryDelay(new Headers(),{error:{details:[{retryDelay:'2.5s'}]}},0),2500);
});

test('provider authorization failure skips all its models; missing models and invalid answers have cooldowns',async()=>{
  const calls:string[]=[];
  const pool=createCloudPool({geminiKey:'g',groqKey:'q',geminiModels:['g1','g2'],groqModels:['openai/gpt-oss-20b','openai/gpt-oss-120b'],fetcher:(async(url,options)=>{
    calls.push(String(url));if(String(url).includes('googleapis'))return Response.json({error:{}},{status:403});
    return JSON.parse(options!.body as string).model==='openai/gpt-oss-20b'?groq(''):groq('Working');
  }) as typeof fetch});
  const response=await pool.transport('',init());assert.match(await response.text(),/Working/);assert.equal(calls.length,3);
  assert.equal(pool.status().pool.filter(m=>m.state==='cooling').length,3);
});

test('vision survives cloud failover and never reaches text-only Groq models',async()=>{
  const models:string[]=[];
  const pool=createCloudPool({geminiKey:'g',groqKey:'q',geminiModels:['g1'],groqModels:['openai/gpt-oss-20b','qwen/qwen3.8-27b'],fetcher:(async(url,options)=>{
    const body=JSON.parse(options!.body as string);
    if(String(url).includes('googleapis')){assert.equal(body.contents[0].parts[1].inlineData.data,'jpeg');return Response.json({}, {status:429});}
    models.push(body.model);assert.equal(body.messages[1].content[1].image_url.url,'data:image/jpeg;base64,jpeg');return groq('A tree.');
  }) as typeof fetch});
  const response=await pool.transport('',init({...input,messages:[input.messages[0],{content:'What do you see here?',role:'user',images:['jpeg']} as any]}));
  assert.equal(response.status,200);assert.deepEqual(models,['qwen/qwen3.8-27b']);
});

test('AnyRouter uses only free routes with zero price caps and validates tool plans',async()=>{
  let calls=0;
  const pool=createCloudPool({anyrouterKey:'private',geminiModels:[],groqModels:[],fetcher:(async(url,options)=>{
    calls++;assert.equal(url,'https://api.anyrouter.dev/api/v1/chat/completions');
    const body=JSON.parse(options!.body as string);assert.match(body.model,/:free$/);assert.deepEqual(body.provider.max_price,{prompt:0,completion:0});
    assert.equal(body.tools[0].function.name,'npc_reply');assert.equal(body.tool_choice.function.name,'npc_reply');
    return Response.json({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'npc_reply',arguments:JSON.stringify({speech:'Another jump!',plan:[{action:'JUMP',targetId:null,interaction:null,state:null}]})}}]}}],usage:{total_tokens:42,cost:0}}, {headers:{'x-anyrouter-free-requests-remaining':'3','x-ratelimit-tier':'free-trial'}});
  }) as typeof fetch});
  const format={properties:{plan:{items:{enum:['JUMP']}}}};
  const r=await pool.transport('',init({...input,stream:false,format} as any));
  assert.deepEqual(JSON.parse((await r.json()).message.content).plan,['JUMP']);assert.equal(calls,1);assert.equal(pool.status().usage.freeRequestsRemaining,3);
});

test('manual selection pins a single model and cooldown does not switch providers',async()=>{
  let calls=0;
  const pool=createCloudPool({geminiKey:'g',groqKey:'q',geminiModels:['g1','g2'],fetcher:(async(url)=>{calls++;assert.match(String(url),/g2:/);return Response.json({}, {status:429,headers:{'retry-after':'60'}});}) as typeof fetch});
  const request={...init(),headers:{'X-NPC-Cloud-Provider':'gemini','X-NPC-Model':'g2'}};
  assert.equal((await pool.transport('',request)).status,503);assert.equal(calls,1);
  await pool.transport('',request);assert.equal(calls,1);
  assert.equal((await pool.transport('',{...request,headers:{'X-NPC-Cloud-Provider':'anyrouter','X-NPC-Model':'paid/model'}})).status,400);assert.equal(calls,1);
});

test('Z.ai uses only its free flash models with thinking disabled and parses structured replies',async()=>{
  const models:string[]=[];
  const pool=createCloudPool({zaiKey:'private-zai',geminiModels:[],groqModels:[],fetcher:(async(url,options)=>{
    assert.equal(url,'https://api.z.ai/api/paas/v4/chat/completions');
    const body=JSON.parse(options!.body as string);models.push(body.model);assert.deepEqual(body.thinking,{type:'disabled'});
    return Response.json({choices:[{finish_reason:'stop',message:{content:'```json\n{"speech":"Hello from Z.ai!","plan":[{"action":"JUMP","targetId":null,"interaction":null,"state":null}]}\n```'}}],usage:{total_tokens:18}});
  }) as typeof fetch});
  const format={properties:{plan:{items:{enum:['JUMP']}}}};
  const r=await pool.transport('',init({...input,stream:false,format} as any));
  assert.deepEqual(JSON.parse((await r.json()).message.content).plan,['JUMP']);
  assert.deepEqual(models,['glm-4.7-flash']);
  assert.deepEqual(pool.catalog().filter(m=>m.provider==='zai'),[
    {provider:'zai',model:'glm-4.7-flash',vision:false,configured:true},
    {provider:'zai',model:'glm-4.5-flash',vision:false,configured:true},
    {provider:'zai',model:'glm-4.6v-flash',vision:true,configured:true},
  ]);
});

test('AnyRouter free-model 429 cools its account pool instead of hammering every free model',async()=>{

  let calls=0;const pool=createCloudPool({anyrouterKey:'q',geminiModels:[],groqModels:[],fetcher:(async()=>{calls++;return Response.json({}, {status:429,headers:{'retry-after':'20'}});}) as typeof fetch});
  assert.equal((await pool.transport('',init())).status,503);assert.equal(calls,1);
  assert.equal(pool.status().pool.filter(e=>e.state==='cooling').length,3);
});

test('ordinary chat omits unnecessary pixels, while visual questions require a vision-capable free route',async()=>{
  const models:string[]=[];const pool=createCloudPool({anyrouterKey:'q',geminiModels:[],groqModels:[],fetcher:(async(_,options)=>{const body=JSON.parse(options!.body as string);models.push(body.model);assert.equal(Array.isArray(body.messages[1].content),body.model.includes('super-vl'));return groq('A bench.');}) as typeof fetch});
  await pool.transport('',init({...input,messages:[input.messages[0],{...input.messages[1],images:['jpeg']} as any]}));
  await pool.transport('',init({...input,messages:[input.messages[0],{role:'user',content:'What color is this?',images:['jpeg']} as any]}));
  assert.match(models[0],/minimax/);assert.match(models[1],/super-vl/);
});

test('timeouts fail over, but caller cancellation never retries or penalizes another model',async()=>{
  let calls=0;
  const pool=createCloudPool({geminiKey:'g',geminiModels:['g1','g2'],groqModels:[],attemptMs:10,fetcher:(async(_,options)=>{
    calls++;if(calls===2)return gemini();return new Promise((_resolve,reject)=>options!.signal!.addEventListener('abort',()=>reject(Error('aborted'))));
  }) as typeof fetch});
  assert.equal((await pool.transport('',init())).status,200);assert.equal(calls,2);
  const controller=new AbortController();controller.abort();await assert.rejects(pool.transport('',init(input,controller.signal)));assert.equal(calls,2);
});

test('exhausted pool returns bounded 503 with no busy retries',async()=>{
  let calls=0;const pool=createCloudPool({geminiKey:'g',geminiModels:['g1'],groqModels:[],fetcher:(async()=>{calls++;return Response.json({}, {status:404});}) as typeof fetch});
  assert.equal((await pool.transport('',init())).status,503);assert.equal((await pool.transport('',init())).status,503);assert.equal(calls,1);
});

test('HTTP middleware validates an invalid action before failover and returns only the successful plan',async()=>{
  let calls=0;
  const pool=createCloudPool({geminiKey:'g',geminiModels:['g1','g2'],groqModels:[],fetcher:(async()=>{calls++;return gemini(JSON.stringify({speech:calls===1?'Bad':'Again!',plan:[{action:calls===1?'RUN_CODE':'JUMP',targetId:null,interaction:null,state:null}]}));}) as typeof fetch});
  const server=createServer((req,res)=>void pool.middleware(req,res,()=>res.end()));server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const response=await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/npc/thought`,{method:'POST',body:JSON.stringify({npc:{x:0,z:0,action:'WAIT',visited:[]},player:{x:0,z:8},lanternOn:false,request:'Do it again',history:['Player: Jump']})});
    const result=await response.json();assert.equal(response.status,200);assert.equal(result.model,'g2');assert.deepEqual(result.plan,['JUMP']);assert.equal(result.speech,'Again!');assert.equal(calls,2);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('manual HTTP requests validate catalog selections and status identifies the pinned model without inference',async()=>{
  let calls=0;
  const pool=createCloudPool({geminiKey:'private-api-key',geminiModels:['g1','g2'],groqModels:[],fetcher:(async url=>{calls++;assert.match(String(url),/g2:/);return gemini();}) as typeof fetch});
  const server=createServer((req,res)=>void pool.middleware(req,res,()=>res.end()));server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const base=`http://127.0.0.1:${(server.address() as any).port}/api/npc/thought`;
    const headers={'X-NPC-Provider':'manual','X-NPC-Cloud-Provider':'gemini','X-NPC-Model':'g2'};
    const catalog=await(await fetch(base+'/models')).json();assert.equal(catalog.models[1].model,'g2');assert.equal(catalog.models[1].configured,true);assert.doesNotMatch(JSON.stringify(catalog),/private-api-key/);
    const status=await(await fetch(base+'/status',{headers})).json();assert.equal(status.mode,'manual');assert.equal(status.model,'g2');assert.equal(calls,0);
    const response=await fetch(base,{method:'POST',headers,body:JSON.stringify({npc:{x:0,z:0,action:'WAIT',visited:[]},player:{x:0,z:8},lanternOn:false,request:'Who are you?'})});assert.equal(response.status,200);assert.equal((await response.json()).model,'g2');assert.equal(calls,1);
    assert.equal((await fetch(base+'/status',{headers:{...headers,'X-NPC-Model':'anything'}})).status,400);assert.equal(calls,1);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
