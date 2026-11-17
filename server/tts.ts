import {once} from 'node:events';
import {deepgramVoices,localVoices,defaultDeepgramVoice} from '../src/voice-options.ts';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {LocalTts} from './local-tts.ts';

export function pcmToWav(pcm:Buffer,rate=24000):Buffer {
  const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+pcm.length,4);header.write('WAVE',8);
  header.write('fmt ',12);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);
  header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);
  header.write('data',36);header.writeUInt32LE(pcm.length,40);return Buffer.concat([header,pcm]);
}
export function createTtsMiddleware(options:{fetcher?:typeof fetch;deepgramKey?:string;deepgramTimeoutMs?:number;local?:Pick<LocalTts,'status'|'synthesize'>}) {
  const json=(res:ServerResponse,status:number,error:string)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({error}));};
  return async(req:IncomingMessage,res:ServerResponse,next:()=>void)=>{
    if(req.url==='/api/npc/tts/status'){
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
      const local=options.local?.status();
      res.end(JSON.stringify({...local,configured:!!options.deepgramKey||!!local?.configured,defaultEngine:options.deepgramKey?'deepgram':'paradee',engines:[{id:'deepgram',name:'Deepgram',configured:!!options.deepgramKey,voices:deepgramVoices},{id:'paradee',name:'Paradee',configured:!!local?.configured,voices:localVoices}]}));return;
    }
    if(req.url!=='/api/npc/tts')return next();
    if(req.method!=='POST')return json(res,405,'POST required');
    if(req.headers.origin && ![`http://${req.headers.host}`,`https://${req.headers.host}`].includes(req.headers.origin))return json(res,403,'Origin not allowed');
    let text:string,engine:string,voice:string,localVoice:string,stream=false;
    try{let body='';for await(const chunk of req){body+=chunk;if(body.length>4000)throw Error();}
      const input=JSON.parse(body);text=input.text;stream=input.stream===true;engine=input.engine||(options.deepgramKey?'deepgram':'paradee');if(!['paradee','deepgram'].includes(engine))throw Error();localVoice=input.localVoice||options.local?.status().voice||'am_puck';voice=input.voice||(engine==='deepgram'?defaultDeepgramVoice:localVoice);if(!(engine==='deepgram'?deepgramVoices:localVoices).some(v=>v.id===voice)||!localVoices.some(v=>v.id===localVoice))throw Error();if(typeof text!=='string'||!text.trim()||text.length>600)throw Error();
    }catch{return json(res,400,'Invalid speech text');}
    let fallback='';
    if(engine==='deepgram'){
      fallback='not-configured';
      if(options.deepgramKey){
        const controller=new AbortController(),cancel=()=>controller.abort();
        const timer=setTimeout(cancel,options.deepgramTimeoutMs??5000);const deadline=setTimeout(cancel,30000);res.once('close',cancel);
        const started=performance.now();
        try{
          const response=await(options.fetcher||fetch)(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(voice)}&encoding=linear16&container=${stream?'none':'wav'}&sample_rate=24000`,{
            method:'POST',headers:{Authorization:`Token ${options.deepgramKey}`,'Content-Type':'application/json'},body:JSON.stringify({text}),signal:controller.signal});
          if(!response.ok){await response.body?.cancel();fallback=`http-${response.status}`;}
          else{
            if(!response.body)throw Error('Empty audio');
            const reader=response.body.getReader(),chunks:Buffer[]=[];let size=0;
            if(stream&&!/audio\/(l16|pcm|raw)/i.test(response.headers.get('content-type')||''))throw Error('Invalid PCM response');
            while(true){
              const chunk=await reader.read();if(chunk.done)break;if(!chunk.value.length)continue;
              size+=chunk.value.length;if(size>10000000){await reader.cancel();throw Error('Audio too large');}
              timer.refresh();
              if(stream){
                if(res.destroyed)return;
                if(!res.headersSent)res.writeHead(200,{'Content-Type':'audio/pcm','Cache-Control':'no-store','X-Accel-Buffering':'no','X-NPC-Voice-Provider':'deepgram','X-NPC-Voice':voice,'X-Audio-Sample-Rate':'24000','X-Synthesis-Ms':String(Math.round(performance.now()-started))});
                if(!res.write(chunk.value))await once(res,'drain',{signal:controller.signal});
              }else chunks.push(Buffer.from(chunk.value));
            }
            if(stream){if(!size||size%2)throw Error('Incomplete PCM');res.end();return;}
            const wav=Buffer.concat(chunks);
            if(wav.length<=44||wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE')throw Error('Invalid WAV');
            if(res.destroyed)return;
            res.writeHead(200,{'Content-Type':'audio/wav','Cache-Control':'no-store','X-NPC-Voice-Provider':'deepgram','X-NPC-Voice':voice,'X-Synthesis-Ms':String(Math.round(performance.now()-started))});res.end(wav);return;
          }
        }catch{if(res.headersSent){res.destroy();return;}fallback=controller.signal.aborted?'timeout':'unavailable';}
        finally{clearTimeout(timer);clearTimeout(deadline);res.removeListener('close',cancel);}
      }
      if(res.destroyed)return;
      if(!options.local)return json(res,503,'Deepgram unavailable and local voice is not installed. Text remains available.');
    }
    if(options.local){
      try{
        const audio=await options.local.synthesize(text,engine==='paradee'?voice:localVoice);
        if(res.destroyed)return;
        res.writeHead(200,{'Content-Type':'audio/wav','Cache-Control':'no-store','X-NPC-Voice-Provider':'local','X-Synthesis-Ms':String(audio.latencyMs),'X-NPC-Voice':engine==='paradee'?voice:localVoice,...(fallback?{'X-NPC-Voice-Fallback':fallback}:{})});
        res.end(audio.wav);
      }catch(error){if(!res.destroyed)json(res,503,(error instanceof Error?error.message:'Local voice unavailable')+' Text remains available.');}
      return;
    }
    return json(res,503,'Local voice is not installed. Run npm run tts:setup. Text remains available.');
  };
}
