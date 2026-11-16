import type { IncomingMessage, ServerResponse } from 'node:http';
import { ACTIONS, isActionRequest, type NpcAction } from '../src/game/npc-contract.ts';
import { validateState } from './decision.ts';
import {validateView} from './vision.ts';

export type Thought = { speech: string; plan: NpcAction[] };
export function parseThought(value: unknown): Thought {
  const thought=value as Thought;
  if (!thought || typeof thought.speech!=='string' || !thought.speech.trim() || thought.speech.length>600 ||
    !Array.isArray(thought.plan) || thought.plan.length>3 || thought.plan.some(a=>!Object.hasOwn(ACTIONS,a))) throw new Error('Invalid thought');
  return {speech:thought.speech.trim(),plan:thought.plan};
}
export function createThoughtMiddleware(options:{apiKey?:string;model?:string;fetcher?:typeof fetch}) {
  const model=options.model || 'gemini-2.5-flash';
  let busy=false, attempts=0;
  const send=(res:ServerResponse,status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  return async(req:IncomingMessage,res:ServerResponse,next:()=>void)=>{
    if(req.url==='/api/npc/thought/status') return send(res,200,{configured:!!options.apiKey,model,remaining:20-attempts});
    if(req.url!=='/api/npc/thought') return next();
    if(req.method!=='POST') return send(res,405,{error:'POST required'});
    if(req.headers.origin && ![`http://${req.headers.host}`,`https://${req.headers.host}`].includes(req.headers.origin)) return send(res,403,{error:'Origin not allowed'});
    let state,history,view;
    try {
      let body=''; for await(const chunk of req){body+=chunk;if(body.length>1100000)throw Error();}
      const input=JSON.parse(body);state=validateState(input);view=validateView(input.view);
      history=Array.isArray(input.history)?input.history.slice(-8).map((turn:unknown)=>String(turn).slice(0,700)):[];
    }catch{return send(res,400,{error:'Invalid courtyard state'});}
    if(!options.apiKey)return send(res,503,{error:'Gemini key not configured'});
    if(busy || attempts>=20)return send(res,429,{error:busy?'Gemini is still thinking':'Gemini session allowance reached'});
    busy=true;attempts++;const started=performance.now();
    try {
      const response=await(options.fetcher || fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{
        method:'POST',headers:{'x-goog-api-key':options.apiKey,'Content-Type':'application/json'},signal:AbortSignal.timeout(25000),
        body:JSON.stringify({systemInstruction:{parts:[{text:'You roleplay the caretaker of a small walled courtyard. Answer the actual player question directly and naturally in 1-3 short sentences. Never substitute a generic greeting or a tour offer for an answer. Questions about objects are conversation, not commands: return an empty plan unless the player explicitly asks you to do something. Do not volunteer unrelated errands. Consider the player request, recent conversation and current task. Return speech and up to three executable actions as a thoughtful plan. Empty plan means keep the existing task. Do not invent objects or claim tasks are complete before arrival. Landmarks: waystone, lantern, arch, garden. The attached image is the player camera view, not your own eyes. The center crosshair identifies what the player means by this or there. Use the image and supplied target to answer visual questions. For stand there or similar explicit movement requests, choose MOVE_TO_TARGET only if target.ground is true. Do not invent coordinates; the game executes the supplied hit point. If no valid target, explain how to point at clear ground. No code or tools beyond the allowed actions. You are a simulated character, not a conscious being.'}]},
          contents:[{role:'user',parts:[{text:JSON.stringify({state,history,target:view.target,actions:ACTIONS})},...(view.image?[{inlineData:{mimeType:'image/jpeg',data:view.image.split(',')[1]}}]:[])]}],
          generationConfig:{maxOutputTokens:700,thinkingConfig:{thinkingBudget:0},responseMimeType:'application/json',responseSchema:{type:'OBJECT',properties:{speech:{type:'STRING'},plan:{type:'ARRAY',items:{type:'STRING',enum:Object.keys(ACTIONS)},maxItems:3}},required:['speech','plan']}}})});
      if(!response.ok)return send(res,response.status===429?429:502,{error:`Gemini request failed (HTTP ${response.status}); current action continues.`});
      const data=await response.json();
      const text=data.candidates?.[0]?.content?.parts?.filter((p:{thought?:boolean})=>!p.thought).map((p:{text?:string})=>p.text||'').join('');
      return send(res,200,{...parseThought(JSON.parse(text)),...(!isActionRequest(state.request)?{plan:[]}:{}),model,latencyMs:Math.round(performance.now()-started),remaining:20-attempts});
    }catch{return send(res,502,{error:'Gemini timed out or returned an invalid plan; current action continues.'});}
    finally{busy=false;}
  };
}
