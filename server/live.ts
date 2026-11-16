import {LEGACY_ACTIONS,canPlanActions,type NpcAction,type ViewContext,type DecisionState} from '../src/game/npc-contract.ts';
import {pcmToWav} from './tts.ts';

export type LiveReply={speech:string;plan:NpcAction[];audio?:string};
export function validateLiveReply(value:unknown):LiveReply {
  const r=value as LiveReply;
  if(!r||typeof r.speech!=='string'||!r.speech.trim()||r.speech.length>600||!Array.isArray(r.plan)||r.plan.length>3||r.plan.some(a=>!LEGACY_ACTIONS.includes(a)))throw Error('Invalid Live action plan');
  return {speech:r.speech.trim(),plan:r.plan};
}

/** One bounded Live turn per message. No browser key, idle connection, or automatic retries. */
export function liveThought(options:{apiKey:string;model:string;instruction:string;state:DecisionState;history:string[];view:ViewContext;signal?:AbortSignal;connect?:(url:string)=>WebSocket;onReply?:(reply:LiveReply)=>void;onAudio?:(pcm:string)=>void;onText?:(text:string)=>void}):Promise<LiveReply> {
  return new Promise((resolve,reject)=>{
    const actionRequested=canPlanActions(options.state.request);
    const socket=(options.connect || (url=>new WebSocket(url)))('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key='+encodeURIComponent(options.apiKey));
    let done=false,reply:LiveReply|undefined,transcript='',audioBytes=0,toolCalls=0;
    const audio:Buffer[]=[];
    const finish=(error?:Error)=>{
      if(done)return;done=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);
      socket.close();
      if(error)return reject(error);
      if(!reply)return reject(Error('Live model returned no structured response'));
      resolve({...reply,...(audio.length?{audio:'data:audio/wav;base64,'+pcmToWav(Buffer.concat(audio)).toString('base64')}: {})});
    };
    const abort=()=>finish(Error('Live request cancelled'));
    const timer=setTimeout(()=>finish(Error('Live model timed out')),40000);
    options.signal?.addEventListener('abort',abort,{once:true});
    if(options.signal?.aborted){abort();return;}
    const send=(data:unknown)=>socket.send(JSON.stringify(data));
    socket.onopen=()=>send({setup:{model:'models/'+options.model,generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:'Kore'}}}},outputAudioTranscription:{},
      systemInstruction:{parts:[{text:options.instruction+(actionRequested?' Speak immediately and call reply_to_player with the same speech and requested actions. Do not wait for the tool response or repeat yourself.':' Answer aloud immediately in one short sentence. No action plan or tool call is needed.')}]},
      ...(actionRequested?{tools:[{functionDeclarations:[{name:'reply_to_player',behavior:'NON_BLOCKING',parameters:{type:'OBJECT',properties:{speech:{type:'STRING'},plan:{type:'ARRAY',items:{type:'STRING',enum:LEGACY_ACTIONS}}},required:['speech','plan']}}]}]}:{})}});
    socket.onmessage=async event=>{
      try{
        const message=JSON.parse(typeof event.data==='string'?event.data:await event.data.text());if(done)return;
        if(message.error)return finish(Error(`Google Live rejected the request (${message.error.code||'unknown error'})`));
        if(message.setupComplete){
          // Keep the screenshot and question in one ordered turn; mixing realtime video
          // with clientContent can let generation start before the frame is processed.
          send({clientContent:{turns:[{role:'user',parts:[{text:options.state.request+'\nCurrent task: '+options.state.npc.action+'. Lantern on: '+options.state.lanternOn+'. Player location: '+JSON.stringify(options.state.player)+'. Pointed target: '+JSON.stringify(options.view.target||null)+'. Recent dialogue: '+options.history.join(' | ')},...(options.view.image?[{inlineData:{mimeType:'image/jpeg',data:options.view.image.split(',')[1]}}]:[])]}],turnComplete:true}});
        }
        if(message.toolCall){
          const calls=message.toolCall.functionCalls||[];
          for(const call of calls){
            if(call.name!=='reply_to_player'||++toolCalls>1)throw Error('Unsupported or repeated Live tool call');
            reply=validateLiveReply(call.args);options.onReply?.(reply);
          }
          send({toolResponse:{functionResponses:calls.map((call:{id:string;name:string})=>({id:call.id,name:call.name,response:{result:'Recorded. Do not repeat the reply.',scheduling:'SILENT'}}))}});
        }
        const content=message.serverContent;
        if(content){
          const delta=content.outputTranscription?.text||'';transcript+=delta;if(delta)options.onText?.(delta);
          for(const part of content.modelTurn?.parts||[]){
            if(part.inlineData?.data){
              if(!/^audio\/pcm|^audio\/L16/i.test(part.inlineData.mimeType||''))throw Error('Unsupported Live audio format');
              const bytes=Buffer.from(part.inlineData.data,'base64');audioBytes+=bytes.length;
              if(audioBytes>4000000)throw Error('Live audio response too large');audio.push(bytes);options.onAudio?.(part.inlineData.data);
            }
          }
          if(content.turnComplete){
            // No tool call is acceptable only for conversation: never infer executable actions from prose.
            if(!reply && transcript.trim())reply=validateLiveReply({speech:transcript.trim(),plan:[]});
            if(audio.length && !message.toolCall)finish();
          }
        }
      }catch{finish(Error('Google Live returned an invalid response'));}
    };
    socket.onerror=()=>finish(Error('Google Live connection failed'));
    socket.onclose=event=>{if(!done)finish(Error(event.code===1008?'Google Live denied access or quota; check AI Studio limits':`Google Live closed before completing (code ${event.code})`));};
  });
}
