import {findObjects,resolveObjectRequest} from '../src/game/world-contract.ts';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {ACTIONS,canPlanActions,playerDirective,planStepSchema} from '../src/game/npc-contract.ts';
import {validateState} from './decision.ts';
import {validateView} from './vision.ts';
import {caretakerInstruction} from './npc-instructions.ts';
import {parseThought} from './thought.ts';
import {LOCAL_MODEL,LOCAL_URL} from './local-llm.ts';

const schema={type:'object',properties:{speech:{type:'string',maxLength:600},plan:{type:'array',items:{type:'string',enum:Object.keys(ACTIONS)},maxItems:3}},required:['speech','plan'],additionalProperties:false};

export function createLocalThoughtMiddleware(options:{model?:string;baseUrl?:string;fetcher?:typeof fetch;start?:()=>Promise<void>;status?:()=>Promise<unknown>;provider?:string;usage?:()=>unknown;compactContext?:boolean;perception?:()=>unknown}){
  const model=options.model||LOCAL_MODEL,base=options.baseUrl||LOCAL_URL,fetcher=options.fetcher||fetch;
  const provider=options.provider||'local';
  let active:AbortController|undefined;
  const send=(res:ServerResponse,status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  return async(req:IncomingMessage,res:ServerResponse,next:()=>void)=>{
    if(req.url==='/api/npc/thought/status')return send(res,200,options.status?await options.status():{provider:'local',model,configured:true,remaining:null});
    if(req.url!=='/api/npc/thought')return next();
    if(req.method!=='POST')return send(res,405,{error:'POST required'});
    if(req.headers.origin && ![`http://${req.headers.host}`,`https://${req.headers.host}`].includes(req.headers.origin))return send(res,403,{error:'Origin not allowed'});
    let state,view,history:string[],deliberate=false,actionResult=false;
    try{
      let body='';for await(const chunk of req){body+=chunk;if(body.length>1100000)throw Error();}
      const input=JSON.parse(body);state=validateState(input);view=validateView(input.view,state.world?.limit||25);deliberate=input.deliberate===true;actionResult=input.event==='action_result';
      history=Array.isArray(input.history)?input.history.slice(-6).map((turn:unknown)=>String(turn).slice(0,600)):[];
    }catch{return send(res,400,{error:'Invalid courtyard state'});}
    // New player requests supersede cancelled/stale turns instead of failing with busy/429.
    active?.abort();const controller=new AbortController();active=controller;
    const started=performance.now(),streaming=!!req.headers.accept?.includes('application/x-ndjson');
    const cancel=()=>controller.abort();res.once('close',cancel);
    const timer=setTimeout(cancel,40000);
    const event=(type:string,data:unknown)=>{if(!res.destroyed)res.write(JSON.stringify({type,data})+'\n');};
    res.setHeader('X-NPC-Vision',view.image?'received':'none');
    res.setHeader('X-NPC-Provider',provider);res.setHeader('X-NPC-Audio','none');
    try{
      await options.start?.();if(controller.signal.aborted)throw Error('Cancelled');
      const action=!actionResult&&(deliberate||canPlanActions(state.request));
      const directive=deliberate||actionResult?undefined:playerDirective(state.request);
      const world=state.world;
      const resolved=world&&action?resolveObjectRequest(state.request,world,state.player,view.target):undefined;
      const nearby=world?[...world.objects].sort((a,b)=>Math.hypot(a.position.x-state.player.x,a.position.z-state.player.z)-Math.hypot(b.position.x-state.player.x,b.position.z-state.player.z)):[];
      const priority=world?[...findObjects(state.request,world.objects,state.player),...world.objects.filter(object=>object.id===view.target?.objectId||['landmark','bench','lantern','waystone'].includes(object.id)),...nearby]:[];
      const objects=[...new Map(priority.map(object=>[object.id,object])).values()].slice(0,options.compactContext&&!action?4:12);
      const worldContext=world?{id:world.id,name:world.name,objects:objects.map(({id,name,kind,color,position,actions,state,description})=>({id,name,kind,color,position,actions,state,description})),resolvedRequest:resolved?.step,resolutionIssue:resolved?.error}:undefined;
      const format={...schema,properties:{...schema.properties,plan:{...schema.properties.plan,items:directive?{type:'string',enum:[directive]}:planStepSchema(objects.map(object=>object.id))}}};
      const objectInstructions=world?' Use the retrieved world objects and their current IDs. Plan object steps as {"action":"GUIDE_TO_OBJECT","targetId":"id"} to show a place, GO_TO_OBJECT to walk there, INSPECT_OBJECT to examine, or INTERACT_OBJECT with interaction read/toggle/sit/ring/water/open only if supported. Honor resolvedRequest when present. Speak naturally; do not recite coordinates or object IDs. For guiding, invite the player to follow; do not claim arrival before reaching the object. Never substitute the waystone for an unknown object. If the target is ambiguous or absent, ask or explain and return an empty plan.':'';

      const messages=[{role:'system',content:caretakerInstruction(state.request,deliberate,actionResult)+objectInstructions+(resolved?.error?' The engine could not resolve this request. Explain resolutionIssue naturally and return an empty plan.':'')+(directive?' The engine has resolved a direct instruction in retrieved context. Acknowledge it in your own words only; do not offer to lead them anywhere or resume an earlier task.':'')+(view.image?' A screenshot is attached to this turn.':' No screenshot is attached to this turn. Do not invent visible objects or describe a view.')+(action?' Return JSON with speech and plan. Follow the player request, not the current task. Allowed actions: '+JSON.stringify(ACTIONS):' Reply in brief natural dialogue only; do not output JSON or action names.')},
        ...(directive||deliberate?[]:history).map(turn=>({role:turn.startsWith('Player:')?'user':'assistant',content:turn.replace(/^(Player|Caretaker):\s*/, '')})),
        {role:'user',content:'Game context: '+JSON.stringify({directive,currentTask:state.npc.action,npc:state.npc,player:state.player,lanternOn:state.lanternOn,target:view.target,perspective:view.perspective,world:worldContext})+'\nPlayer request: '+state.request,...(view.image?{images:[view.image.split(',')[1]]}:{})}];
      const response=await fetcher(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
        body:JSON.stringify({model,messages,think:false,stream:!action,keep_alive:'10m',...(action?{format}:{}),options:{num_ctx:4096,num_batch:128,num_predict:180,temperature:0.3}})});
      if(!response.ok){
        if(provider==='groq'){const problem=await response.json().catch(()=>({}));return send(res,response.status,{error:problem.error||'Groq request failed.',usage:options.usage?.()});}
        if(response.status===404)return send(res,503,{error:'Local model is missing. Run npm run llm:setup.'});
        throw Error('Local model request failed');
      }
      const perception=options.perception?.() as {used?:boolean;error?:string}|undefined;
      if(perception)res.setHeader('X-NPC-Vision-Source',perception.error?'local-error':perception.used?'local':'unused');
      if(streaming){res.writeHead(200,{'Content-Type':'application/x-ndjson','Cache-Control':'no-store','X-Accel-Buffering':'no'});res.flushHeaders();}
      let reply;
      if(action){
        reply=parseThought(JSON.parse((await response.json()).message.content));
        for(const step of reply.plan)if(typeof step!=='string'&&(!objects.some(object=>object.id===step.targetId)||step.action==='INTERACT_OBJECT'&&!objects.find(object=>object.id===step.targetId)!.actions.includes(step.interaction!)))throw Error('Invalid world target');
        if(resolved?.step)reply.plan=[resolved.step];
        if(directive){if(reply.plan.some(step=>step!==directive))throw Error('Conflicting direct command');reply.plan=[directive];}
        if(resolved?.error)reply.plan=[];
      }
      else{
        const reader=response.body!.getReader(),decoder=new TextDecoder();let pending='',speech='',completed=false;
        const consume=(line:string)=>{
          if(!line.trim())return;const chunk=JSON.parse(line);if(chunk.error)throw Error('Local model generation failed');
          const delta=typeof chunk.message?.content==='string'?chunk.message.content.slice(0,Math.max(0,600-speech.length)):'';
          speech+=delta;if(delta && streaming)event('text',delta);if(chunk.done)completed=true;
        };
        while(true){
          const chunk=await reader.read();pending+=decoder.decode(chunk.value,{stream:!chunk.done});
          let newline;while((newline=pending.indexOf('\n'))>=0){consume(pending.slice(0,newline));pending=pending.slice(newline+1);}
          if(chunk.done){if(pending)consume(pending);break;}
        }
        if(!completed)throw Error('Local model response interrupted');
        reply=parseThought({speech:speech.trim(),plan:[]});
      }
      if(controller.signal.aborted)return;
      const result={...reply,model,provider,...(world?{worldId:world.id}:{}),latencyMs:Math.round(performance.now()-started),remaining:null,...(perception?{perception}:{}),...(options.usage?{usage:options.usage()}: {})};
      if(streaming){event('done',result);res.end();}else send(res,200,result);
    }catch{
      if(res.destroyed)return;
      const error=provider==='groq'?(controller.signal.aborted?'Groq request cancelled or timed out.':'Groq unavailable or returned an invalid plan. Check AI usage and try again.'):controller.signal.aborted?'Local model request cancelled or timed out.':'Local LLM unavailable. Run npm run llm:setup and check .local-llm/ollama.log.';
      if(res.headersSent){event('error',error);res.end();}else send(res,503,{error});
    }finally{clearTimeout(timer);res.removeListener('close',cancel);if(active===controller)active=undefined;}
  };
}
