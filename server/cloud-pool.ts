import {createLocalThoughtMiddleware} from './local-thought.ts';
import {strictSchema} from './groq-thought.ts';
import {parseThought} from './thought.ts';
import {LEGACY_ACTIONS} from '../src/game/npc-contract.ts';
import {resetSeconds} from '../src/ui/ai-usage.ts';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {isVisualRequest} from '../src/game/visual-intent.ts';

export const GEMINI_POOL=['gemini-3.5-flash-lite','gemini-3.1-flash-lite','gemini-3.8-flash','gemini-3.6-flash','gemini-3.5-flash','gemini-3-flash-preview','gemini-2.5-flash-lite','gemini-2.5-flash'];
export const GROQ_POOL=['qwen/qwen3.8-27b','openai/gpt-oss-20b','openai/gpt-oss-120b'];
export const ANYROUTER_POOL=[{model:'minimax/minimax-m3.1-flash:free',vision:false},{model:'nvidia/nemotron-3.5-lightning-30b-a3b:free',vision:false},{model:'nvidia/nemotron-3.5-super-vl-120b-a12b:free',vision:true}];
type Provider='gemini'|'groq'|'anyrouter';
type Entry={provider:Provider;model:string;vision:boolean;availableAt:number;failures:number;reason?:string;requests:number;tokens:number;lastStatus?:number};
/** Honor server retry hints; never infer that another model has independent quota. */
export function retryDelay(headers:Headers,data:any,now:number){
  const value=headers.get('retry-after');
  if(value){const seconds=Number(value);if(Number.isFinite(seconds))return Math.max(1000,seconds*1000);const date=Date.parse(value);if(Number.isFinite(date))return Math.max(1000,date-now);}
  const hint=data?.error?.details?.find((detail:any)=>typeof detail.retryDelay==='string')?.retryDelay;
  if(hint&&/^\d+(\.\d+)?s$/.test(hint))return Math.max(1000,parseFloat(hint)*1000);
}

export function createCloudPool(options:{geminiKey?:string;groqKey?:string;anyrouterKey?:string;geminiModels?:string[];groqModels?:string[];fetcher?:typeof fetch;now?:()=>number;attemptMs?:number;budgetMs?:number}){
  const fetcher=options.fetcher||fetch,now=options.now||Date.now;
  const entries:Entry[]=[...new Set(options.geminiModels??GEMINI_POOL)].map(model=>({provider:'gemini' as const,model,vision:true,availableAt:0,failures:0,requests:0,tokens:0}));
  entries.push(...[...new Set(options.groqModels??GROQ_POOL)].map(model=>({provider:'groq' as const,model,vision:model.startsWith('qwen/'),availableAt:0,failures:0,requests:0,tokens:0})));
  entries.push(...ANYROUTER_POOL.map(entry=>({...entry,provider:'anyrouter' as const,availableAt:0,failures:0,requests:0,tokens:0})));
  const key=(provider:Provider)=>provider==='gemini'?options.geminiKey:provider==='groq'?options.groqKey:options.anyrouterKey;
  const catalog=()=>entries.map(({provider,model,vision})=>({provider,model,vision,configured:!!key(provider)}));
  let active=entries.find(entry=>key(entry.provider)),error='',imageSent=false,usage:Record<string,unknown>={sessionRequests:0,sessionTokens:0};
  const status=()=>({provider:active?.provider||'cloud',model:active?.model,mode:'auto',configured:entries.some(entry=>key(entry.provider)),error:error||undefined,usage:{...usage},pool:entries.map(entry=>({...entry,state:!key(entry.provider)?'unconfigured':entry.availableAt>now()?'cooling':'ready'}))});
  const transport:typeof fetch=async(_input,init)=>{
    const body=JSON.parse(init!.body as string),started=performance.now();
    const request=body.messages.at(-1)?.content.split('\nPlayer request: ').at(-1)||'';
    if(!isVisualRequest(request))for(const message of body.messages)delete message.images;
    const hasImage=body.messages.some((m:any)=>m.images?.length);imageSent=hasImage;
    if(!hasImage)body.messages[0].content=body.messages[0].content.replace('A screenshot is attached to this turn.','No screenshot is attached to this turn. Do not invent visible objects or describe a view.');
    const incoming=new Headers(init?.headers),selectedProvider=incoming.get('X-NPC-Cloud-Provider'),selectedModel=incoming.get('X-NPC-Model');
    if((selectedProvider||selectedModel)&&!entries.some(e=>e.provider===selectedProvider&&e.model===selectedModel))return Response.json({error:'Choose a supported provider and model.'},{status:400});
    const candidates=selectedProvider?entries.filter(e=>e.provider===selectedProvider&&e.model===selectedModel):entries;
    const waits={gemini:0,groq:0,anyrouter:0};
    for(const entry of candidates){
      if(init?.signal?.aborted)throw Error('Cancelled');
      if(!key(entry.provider)||entry.availableAt>now()||(hasImage&&!entry.vision))continue;
      const left=(options.budgetMs??28000)-(performance.now()-started);
      // Reserve time for later providers if an earlier provider stalls.
      if(left<200||!selectedProvider&&entry.provider!=='anyrouter'&&waits[entry.provider]>=9000)continue;
      active=entry;
      const controller=new AbortController(),cancel=()=>controller.abort();init?.signal?.addEventListener('abort',cancel,{once:true});
      const timer=setTimeout(cancel,Math.min(options.attemptMs??(selectedProvider?10000:entry.provider==='anyrouter'?8000:4500),left)),attempt=performance.now();
      try{
        const messages=structuredClone(body.messages);
        if(body.format){
          for(const m of messages)if(m.role==='assistant')m.content=JSON.stringify({speech:m.content,plan:[]});
          messages[0].content+=' Each plan step must be an object. Set irrelevant targetId, interaction and state fields to null. Speech does not execute actions.';
        }
        let url:string,payload:any,headers:Record<string,string>={'Content-Type':'application/json'};
        if(entry.provider==='gemini'){
          url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(entry.model)}:generateContent`;headers['x-goog-api-key']=options.geminiKey!;
          payload={systemInstruction:{parts:[{text:messages[0].content}]},contents:messages.slice(1).map((m:any)=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content},...(m.images||[]).map((data:string)=>({inlineData:{mimeType:'image/jpeg',data}}))]})),generationConfig:{maxOutputTokens:body.format?700:300,thinkingConfig:entry.model.startsWith('gemini-2.5')?{thinkingBudget:0}:{thinkingLevel:/gemini-3\.[678]/.test(entry.model)?'low':'minimal'},...(body.format?{responseMimeType:'application/json',responseJsonSchema:strictSchema(body.format)}:{})}};
        }else{
          url=entry.provider==='groq'?'https://api.groq.com/openai/v1/chat/completions':'https://api.anyrouter.dev/api/v1/chat/completions';headers.Authorization=`Bearer ${key(entry.provider)}`;
          payload={model:entry.model,messages:messages.map(({images,content,...m}:any)=>({...m,content:images?.length?[{type:'text',text:content},...images.map((data:string)=>({type:'image_url',image_url:{url:'data:image/jpeg;base64,'+data}}))]:content})),stream:false,max_completion_tokens:body.format?700:300,reasoning_effort:entry.model.startsWith('qwen/')?'none':'low',...(body.format?{response_format:{type:'json_schema',json_schema:{name:'npc_reply',strict:true,schema:strictSchema(body.format)}}}:{})};
          if(entry.provider==='anyrouter'){
            delete payload.max_completion_tokens;delete payload.response_format;delete payload.reasoning_effort;
            payload.max_tokens=body.format?1200:700;
            payload.provider={max_price:{prompt:0,completion:0},sort:'ttft'};
            if(entry.model.startsWith('minimax/'))payload.reasoning_effort='low';
            if(body.format){payload.tools=[{type:'function',function:{name:'npc_reply',description:'Return NPC dialogue and a validated proposed action plan.',parameters:strictSchema(body.format)}}];payload.tool_choice={type:'function',function:{name:'npc_reply'}};}
          }
        }
        entry.requests++;usage={...usage,sessionRequests:Number(usage.sessionRequests)+1};
        const response=await fetcher(url,{method:'POST',headers,body:JSON.stringify(payload),signal:controller.signal});
        entry.lastStatus=response.status;
        const data=await response.json();
        if(!response.ok){
          const code=response.status;
          // Only explicit provider-wide billing/auth failures disable the entire provider.
          const shared=[401,402,403].includes(code)||code===429&&(entry.provider==='anyrouter'||/\b(project|organization|organisation)[ -]wide\b/i.test(data?.error?.message||''));
          const daily=code===429&&JSON.stringify(data?.error?.details||data?.error?.message||'').match(/perday|per_day|daily|tokens per day|requests per day/i);
          const delay=retryDelay(response.headers,data,now())??(shared&&code!==429||code===404||daily?86400000:code===400?3600000:Math.min(300000,15000*2**entry.failures));
          const reason=code===429?(shared?'Provider-wide rate limit':'Rate limited'):shared?'Provider authentication or access unavailable':code===404?'Model unavailable':code===400?'Model rejected request':`HTTP ${code}`;
          for(const target of shared?entries.filter(e=>e.provider===entry.provider):[entry]){target.availableAt=now()+delay;target.reason=reason;target.failures++;}
          error=`${entry.model}: ${reason}. Trying another eligible model.`;continue;
        }
        const tokens=entry.provider==='gemini'?data.usageMetadata?.totalTokenCount:data.usage?.total_tokens;
        entry.tokens+=Number(tokens)||0;usage={...usage,sessionTokens:Number(usage.sessionTokens)+(Number(tokens)||0)};
        const finish=entry.provider==='gemini'?data.candidates?.[0]?.finishReason:data.choices?.[0]?.finish_reason;
        if(finish&&finish!=='STOP'&&finish!=='stop'&&!(body.format&&finish==='tool_calls'))throw Error('Incomplete response');
        const tool=data.choices?.[0]?.message?.tool_calls;
        if(body.format&&tool&&(tool.length!==1||tool[0].function?.name!=='npc_reply'))throw Error('Invalid tool response');
        const text=entry.provider==='gemini'?data.candidates?.[0]?.content?.parts?.filter((p:any)=>!p.thought).map((p:any)=>p.text||'').join(''):body.format&&tool?tool[0].function.arguments:data.choices?.[0]?.message?.content;
        let reply;
        if(body.format){
          const value=JSON.parse(text);
          value.plan=(value.plan||[]).map((step:any)=>{if(step&&typeof step==='object'){for(const k of Object.keys(step))if(step[k]===null)delete step[k];if(LEGACY_ACTIONS.includes(step.action)&&!step.targetId&&!step.interaction&&!step.state)return step.action;}return step;});
          reply=parseThought(value);
          const allowed=strictSchema(body.format).properties.plan.items.properties;
          const context=JSON.parse(messages.at(-1).content.split('\nPlayer request: ')[0].replace('Game context: ',''));
          for(const step of reply.plan){
            const action=typeof step==='string'?step:step.action;
            if(!allowed.action.enum.includes(action))throw Error('Unsupported action');
            if(typeof step!=='string'){
              const object=context.world?.objects.find((o:any)=>o.id===step.targetId);
              if(!object||!allowed.targetId.enum.includes(step.targetId)||step.action==='INTERACT_OBJECT'&&!object.actions.includes(step.interaction))throw Error('Unsupported target');
            }
          }
        }else reply=parseThought({speech:text,plan:[]});
        if(controller.signal.aborted||init?.signal?.aborted)throw Error('Cancelled');
        entry.failures=0;entry.reason=undefined;entry.availableAt=0;error='';
        const n=(name:string)=>{const v=response.headers.get(name);return v!==null&&Number.isFinite(Number(v))?Number(v):null;};
        usage={...usage,updatedAt:now(),lastStatus:200,lastLatencyMs:Math.round(performance.now()-started),requestLimit:n('x-ratelimit-limit-requests'),requestsRemaining:n('x-ratelimit-remaining-requests'),tokenLimit:n('x-ratelimit-limit-tokens'),tokensRemaining:n('x-ratelimit-remaining-tokens'),requestsReset:response.headers.get('x-ratelimit-reset-requests'),tokensReset:response.headers.get('x-ratelimit-reset-tokens')};
        usage={...usage,freeRequestsRemaining:n('x-anyrouter-free-requests-remaining'),tier:response.headers.get('x-ratelimit-tier')};
        const refill=Math.max(n('x-ratelimit-remaining-requests')===0?(resetSeconds(response.headers.get('x-ratelimit-reset-requests'))??60):0,n('x-ratelimit-remaining-tokens')===0?(resetSeconds(response.headers.get('x-ratelimit-reset-tokens'))??60):0);
        if(refill){entry.availableAt=now()+refill*1000;entry.reason='Reported allowance exhausted';}
        if(!body.stream)return Response.json({message:{content:JSON.stringify(reply)}});
        return new Response(JSON.stringify({message:{content:reply.speech}})+'\n'+JSON.stringify({done:true})+'\n');
      }catch{
        if(init?.signal?.aborted)throw Error('Cancelled');
        entry.failures++;entry.availableAt=now()+Math.min(300000,15000*2**(entry.failures-1));entry.reason=controller.signal.aborted?'Response timeout':'Invalid response or connection failure';error=`${entry.model}: ${entry.reason}.`;
      }finally{clearTimeout(timer);init?.signal?.removeEventListener('abort',cancel);waits[entry.provider]+=performance.now()-attempt;}
    }
    error=selectedProvider?`${selectedModel} is unavailable${hasImage&&!candidates[0].vision?' for screenshots; select a vision model or turn off the screenshot checkbox':'; check its cooldown or choose Automatic'}.`:hasImage?'No image-capable cloud model is ready. Check model cooldowns.':'No cloud model is ready. Wait for cooldowns or select Fully local.';
    return Response.json({error},{status:503});
  };
  const handler=createLocalThoughtMiddleware({provider:'cloud',model:'auto',fetcher:transport,visionSource:()=>imageSent?'cloud':'unused',responseMeta:()=>({provider:active?.provider||'cloud',model:active?.model||'auto'}),usage:()=>({...usage}),transportHeaders:(req):Record<string,string>=>req.headers['x-npc-provider']==='manual'?{'X-NPC-Cloud-Provider':String(req.headers['x-npc-cloud-provider']||''),'X-NPC-Model':String(req.headers['x-npc-model']||'')}: {},status:async req=>{
    const result=status();if(req.headers['x-npc-provider']!=='manual')return result;
    const selected=entries.find(e=>e.provider===req.headers['x-npc-cloud-provider']&&e.model===req.headers['x-npc-model'])!;
    return {...result,mode:'manual',provider:selected.provider,model:selected.model,configured:!!key(selected.provider),pool:result.pool.filter(e=>e.provider===selected.provider&&e.model===selected.model),error:selected.availableAt>now()?selected.reason:undefined,usage:selected===active?result.usage:{sessionRequests:usage.sessionRequests,sessionTokens:usage.sessionTokens}};
  }});
  const middleware=(req:IncomingMessage,res:ServerResponse,next:()=>void)=>{
    if(req.url==='/api/npc/thought/models'){res.writeHead(req.method==='GET'?200:405,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(req.method==='GET'?{models:catalog()}:{error:'GET required'}));return;}
    if(req.headers['x-npc-provider']==='manual'&&!entries.some(e=>e.provider===req.headers['x-npc-cloud-provider']&&e.model===req.headers['x-npc-model'])){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Choose a supported provider and model.'}));return;}
    return handler(req,res,next);
  };
  return {transport,status,catalog,middleware};
}
