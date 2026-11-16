import type { IncomingMessage, ServerResponse } from 'node:http';
import { ACTIONS, LEGACY_ACTIONS, canPlanActions, parsePlan, type NpcStep } from '../src/game/npc-contract.ts';
import { validateState } from './decision.ts';
import {validateView} from './vision.ts';
import {liveThought} from './live.ts';
import {caretakerInstruction} from './npc-instructions.ts';

export type Thought = { speech: string; plan: NpcStep[] };
export function parseThought(value: unknown): Thought {
  const thought=value as Thought;
  if (!thought || typeof thought.speech!=='string' || !thought.speech.trim() || thought.speech.length>600 ||
    !Array.isArray(thought.plan) || thought.plan.length>3 ) throw new Error('Invalid thought');
  return {speech:thought.speech.trim(),plan:parsePlan(thought.plan)};
}
export function createThoughtMiddleware(options:{apiKey?:string;model?:string;fetcher?:typeof fetch;limit?:number;textModel?:string;localVoice?:boolean}) {
  const defaultModel=options.model || 'gemini-3.8-live';
  const textModel=options.textModel || 'gemini-3.5-flash-lite';
  const limit=options.limit && options.limit>0?options.limit:null;
  const remaining=()=>limit===null?null:Math.max(0,limit-attempts);
  let busy=false, attempts=0;
  const send=(res:ServerResponse,status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  return async(req:IncomingMessage,res:ServerResponse,next:()=>void)=>{
    if(req.url==='/api/npc/thought/status') return send(res,200,{configured:!!options.apiKey,model:options.localVoice?textModel:defaultModel,textModel,voiceProvider:options.localVoice?'local':'gemini',remaining:remaining()});
    if(req.url!=='/api/npc/thought') return next();
    if(req.method!=='POST') return send(res,405,{error:'POST required'});
    if(req.headers.origin && ![`http://${req.headers.host}`,`https://${req.headers.host}`].includes(req.headers.origin)) return send(res,403,{error:'Origin not allowed'});
    let state,history,view;let model=defaultModel;
    try {
      let body=''; for await(const chunk of req){body+=chunk;if(body.length>1100000)throw Error();}
      const input=JSON.parse(body);state=validateState(input);view=validateView(input.view,state.world?.limit||25);if(input.voice===false || options.localVoice)model=textModel;
      history=Array.isArray(input.history)?input.history.slice(-8).map((turn:unknown)=>String(turn).slice(0,700)):[];
    }catch{return send(res,400,{error:'Invalid courtyard state'});}
    res.setHeader('X-NPC-Vision',view.image?'received':'none');
    if(!options.apiKey)return send(res,503,{error:'Gemini key not configured'});
    if(busy || (limit!==null && attempts>=limit))return send(res,429,{error:busy?'Gemini is still thinking':'Gemini session allowance reached'});
    busy=true;attempts++;const started=performance.now();
    const instruction=caretakerInstruction(state.request);
    const streaming=req.headers.accept?.includes('application/x-ndjson') && /live|native-audio/.test(model);
    const event=(type:string,data:unknown)=>{if(!res.destroyed)res.write(JSON.stringify({type,data})+'\n');};
    try {
      if(/live|native-audio/.test(model)) {
        const controller=new AbortController();
        const cancel=()=>controller.abort();res.once('close',cancel);
        try {
          if(streaming){res.writeHead(200,{'Content-Type':'application/x-ndjson','Cache-Control':'no-store','X-Accel-Buffering':'no'});res.flushHeaders();}
          const result=await liveThought({apiKey:options.apiKey,model,instruction,state,history,view,signal:controller.signal,...(streaming?{onReply:(reply:Thought)=>event('reply',{...reply,plan:canPlanActions(state.request)?reply.plan:[]}),onAudio:(pcm:string)=>event('audio',pcm),onText:(text:string)=>event('text',text)}:{})});
          if(streaming){event('done',{...result,audio:undefined,plan:canPlanActions(state.request)?result.plan:[],model,latencyMs:Math.round(performance.now()-started)});res.end();return;}
          return send(res,200,{...result,...(!canPlanActions(state.request)?{plan:[]}:{}),model,latencyMs:Math.round(performance.now()-started),remaining:remaining()});
        }finally{res.removeListener('close',cancel);}
      }
      const response=await(options.fetcher || fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{
        method:'POST',headers:{'x-goog-api-key':options.apiKey,'Content-Type':'application/json'},signal:AbortSignal.timeout(25000),
        body:JSON.stringify({systemInstruction:{parts:[{text:instruction}]},
          contents:[{role:'user',parts:[{text:JSON.stringify({state,history,target:view.target,actions:ACTIONS})},...(view.image?[{inlineData:{mimeType:'image/jpeg',data:view.image.split(',')[1]}}]:[])]}],
          generationConfig:{maxOutputTokens:700,thinkingConfig:model.startsWith('gemini-3')?{thinkingLevel:'minimal'}:{thinkingBudget:0},responseMimeType:'application/json',responseSchema:{type:'OBJECT',properties:{speech:{type:'STRING'},plan:{type:'ARRAY',items:{type:'STRING',enum:LEGACY_ACTIONS},maxItems:3}},required:['speech','plan']}}})});
      if(!response.ok)return send(res,response.status===429?429:502,{error:`Gemini request failed (HTTP ${response.status}); current action continues.`});
      const data=await response.json();
      const text=data.candidates?.[0]?.content?.parts?.filter((p:{thought?:boolean})=>!p.thought).map((p:{text?:string})=>p.text||'').join('');
      return send(res,200,{...parseThought(JSON.parse(text)),...(!canPlanActions(state.request)?{plan:[]}:{}),model,latencyMs:Math.round(performance.now()-started),remaining:remaining()});
    }catch(error){if(streaming && res.headersSent){event('error','Live response interrupted. Please try again.');res.end();return;}return send(res,502,{error:/live|native-audio/.test(model) && error instanceof Error ? `${error.message}; current action continues.` : 'Gemini timed out or returned an invalid plan; current action continues.'});}
    finally{busy=false;}
  };
}
