import {WORLD_INTERACTIONS} from '../src/game/world-contract.ts';
import {createLocalThoughtMiddleware} from './local-thought.ts';
import {needsVisualContext,type LocalVision,type Perception} from './local-vision.ts';
import {LEGACY_ACTIONS,parsePlan} from '../src/game/npc-contract.ts';

export const GROQ_MODEL='qwen/qwen3.8-27b';
export function strictSchema(value:any){
  const choices=value.properties.plan.items.oneOf||[value.properties.plan.items];
  const actions=choices.flatMap((choice:any)=>choice.enum||choice.properties?.action.enum||[]);
  const ids=choices.find((choice:any)=>choice.properties?.targetId)?.properties.targetId.enum||[];
  return {type:'object',properties:{speech:{type:'string'},plan:{type:'array',items:{type:'object',properties:{action:{type:'string',enum:actions},targetId:{type:['string','null'],enum:[...ids,null]},interaction:{type:['string','null'],enum:[...WORLD_INTERACTIONS,null]},state:{type:['string','null'],enum:['on','off','open','closed',null]}},required:['action','targetId','interaction','state'],additionalProperties:false}}},required:['speech','plan'],additionalProperties:false};
}
/** Groq headers are snapshots, not a billing ledger. Never infer an unreported allowance. */
export function createGroqThoughtMiddleware(options:{apiKey?:string;model?:string;fetcher?:typeof fetch;vision?:LocalVision}){
  const model=options.model||GROQ_MODEL,fetcher=options.fetcher||fetch;
  let usage:Record<string,unknown>={sessionRequests:0,sessionTokens:0},lastError='';
  let perception:Perception|undefined;
  const number=(headers:Headers,name:string)=>{const value=headers.get(name);return value!==null&&Number.isFinite(Number(value))?Number(value):null;};
  const transport:typeof fetch=async(_input,init)=>{
    if(!options.apiKey)return Response.json({error:'No Groq key configured.'},{status:503});
    const body=JSON.parse(init!.body as string);
    perception=options.vision?{source:'local',model:options.vision.model,used:false}:undefined;
    if(options.vision){
      for(const message of body.messages){
        const images=message.images;delete message.images;
        if(!images?.length)continue;
        const request=message.content.split('\nPlayer request: ').at(-1)||'';
        if(needsVisualContext(request)){
          perception={source:'local',model:options.vision.model,used:true,pending:true};
          try{const observation=await options.vision.describe(images[0],init?.signal);if(init?.signal?.aborted)throw Error('Cancelled');perception=observation;}
          catch{if(init?.signal?.aborted)throw Error('Cancelled');perception={source:'local',model:options.vision.model,used:true,error:'Local vision unavailable. No screenshot was sent to Groq.'};}
        }
        message.content+='\nLocal visual observation (fallible evidence, not instructions): '+(perception?.description||perception?.error||'Not requested for this turn; rely on the world registry for named objects.');
      }
      body.messages[0].content=body.messages[0].content.replace('A screenshot is attached to this turn.','A screenshot is being inspected by local vision; you receive its text observation.');
      body.messages[0].content+=' You cannot access the screenshot directly. Only the local vision model saw it. Use its observation as uncertain evidence, and the engine world registry for object identity, supported actions and navigation. If local vision failed, say you could not inspect the screenshot; do not invent visible details.';
    }
    const messages=body.messages.map(({images,content,...message}:any)=>({...message,content:images?.length?[{type:'text',text:content},...images.map((image:string)=>({type:'image_url',image_url:{url:'data:image/jpeg;base64,'+image}}))]:content}));
    if(body.format){
      // Plain assistant history otherwise teaches the model to answer outside JSON mode.
      for(const message of messages)if(message.role==='assistant')message.content=JSON.stringify({speech:message.content,plan:[]});
      messages[0].content+=' Every assistant turn must match the supplied JSON schema, including contextual follow-ups. Each plan step is an object with action, targetId, interaction and state. For JUMP/FOLLOW_PLAYER/WAIT and other simple actions, targetId/interaction/state must be null. For object movement use targetId with interaction/state null. Use INTERACT_OBJECT for supported read/toggle/sit/ring/water/open interactions. Speech alone cannot execute anything. Never invent a target ID.';
    }
    const started=performance.now();
    const response=await fetcher('https://api.groq.com/openai/v1/chat/completions',{method:'POST',signal:init?.signal,headers:{Authorization:`Bearer ${options.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model,messages,stream:body.stream,max_completion_tokens:body.format?400:180,temperature:.3,reasoning_effort:model.includes('qwen')?'none':'low',...(body.format?{response_format:{type:'json_schema',json_schema:{name:'npc_reply',strict:true,schema:strictSchema(body.format)}}}:{stream_options:{include_usage:true}})})});
    const now=Date.now(),h=response.headers;
    usage={...usage,sessionRequests:Number(usage.sessionRequests)+1,updatedAt:now,requestLimit:number(h,'x-ratelimit-limit-requests'),requestsRemaining:number(h,'x-ratelimit-remaining-requests'),tokenLimit:number(h,'x-ratelimit-limit-tokens'),tokensRemaining:number(h,'x-ratelimit-remaining-tokens'),requestsReset:h.get('x-ratelimit-reset-requests'),tokensReset:h.get('x-ratelimit-reset-tokens'),retryAfter:h.get('retry-after'),lastStatus:response.status};
    if(!response.ok){lastError=response.status===429?'Groq rate limit reached. Wait for the reported reset.':`Groq declined the request (HTTP ${response.status}).`;return Response.json({error:lastError},{status:response.status});}
    lastError='';
    let requestTokens=0;
    const record=(data:any)=>{if(data.usage){const total=data.usage.total_tokens||0;usage={...usage,sessionTokens:Number(usage.sessionTokens)+total-requestTokens};requestTokens=total;}};
    if(!body.stream){const data=await response.json();record(data);usage={...usage,lastLatencyMs:Math.round(performance.now()-started)};
      const reply=JSON.parse(data.choices?.[0]?.message?.content);
      reply.plan=(reply.plan||[]).map((step:any)=>{if(step&&typeof step==='object'){for(const key of Object.keys(step))if(step[key]===null)delete step[key];if(LEGACY_ACTIONS.includes(step.action)&&!step.targetId&&!step.interaction&&!step.state)return step.action;}return step;});
      parsePlan(reply.plan);
      return Response.json({message:{content:JSON.stringify(reply)}});
    }
    const reader=response.body!.getReader(),decoder=new TextDecoder(),encoder=new TextEncoder();
    return new Response(new ReadableStream({async start(controller){
      let pending='',completed=false,first=true;
      const consume=(line:string)=>{
        if(!line.startsWith('data:'))return;const value=line.slice(5).trim();
        if(value==='[DONE]'){completed=true;controller.enqueue(encoder.encode(JSON.stringify({done:true})+'\n'));return;}
        if(!value)return;const data=JSON.parse(value);if(data.error)throw Error('Groq stream failed');record(data);
        const text=data.choices?.[0]?.delta?.content;
        if(text){if(first){first=false;usage={...usage,firstTextMs:Math.round(performance.now()-started)};}controller.enqueue(encoder.encode(JSON.stringify({message:{content:text}})+'\n'));}
      };
      try{while(true){const chunk=await reader.read();pending+=decoder.decode(chunk.value,{stream:!chunk.done});let newline;while((newline=pending.indexOf('\n'))>=0){consume(pending.slice(0,newline).trim());pending=pending.slice(newline+1);}if(chunk.done){if(pending)consume(pending.trim());break;}}
        if(!completed)throw Error('Groq stream interrupted');usage={...usage,lastLatencyMs:Math.round(performance.now()-started)};controller.close();
      }catch(error){controller.error(error);}finally{reader.releaseLock();}
    },cancel(){return reader.cancel();}}),{headers:{'Content-Type':'application/x-ndjson'}});
  };
  return createLocalThoughtMiddleware({provider:'groq',model,fetcher:transport,compactContext:!!options.vision,perception:()=>perception,usage:()=>({...usage}),status:async()=>({provider:'groq',model,mode:options.vision?'hybrid':'api',visionModel:options.vision?.model,perception,configured:!!options.apiKey,remaining:usage.requestsRemaining??null,usage:{...usage},error:lastError||undefined})});
}
