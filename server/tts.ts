import type {IncomingMessage,ServerResponse} from 'node:http';
import type {LocalTts} from './local-tts.ts';

export function pcmToWav(pcm:Buffer,rate=24000):Buffer {
  const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+pcm.length,4);header.write('WAVE',8);
  header.write('fmt ',12);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);
  header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);
  header.write('data',36);header.writeUInt32LE(pcm.length,40);return Buffer.concat([header,pcm]);
}
export function createTtsMiddleware(options:{apiKey?:string;model?:string;fetcher?:typeof fetch;local?:Pick<LocalTts,'status'|'synthesize'>}) {
  let busy=false,attempts=0;
  const json=(res:ServerResponse,status:number,error:string)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({error}));};
  return async(req:IncomingMessage,res:ServerResponse,next:()=>void)=>{
    if(req.url==='/api/npc/tts/status'){
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
      res.end(JSON.stringify(options.local?.status()||{provider:'gemini',configured:!!options.apiKey}));return;
    }
    if(req.url!=='/api/npc/tts')return next();
    if(req.method!=='POST')return json(res,405,'POST required');
    if(req.headers.origin && ![`http://${req.headers.host}`,`https://${req.headers.host}`].includes(req.headers.origin))return json(res,403,'Origin not allowed');
    let text:string;
    try{let body='';for await(const chunk of req){body+=chunk;if(body.length>4000)throw Error();}
      text=JSON.parse(body).text;if(typeof text!=='string'||!text.trim()||text.length>600)throw Error();
    }catch{return json(res,400,'Invalid speech text');}
    if(options.local){
      try{
        const audio=await options.local.synthesize(text);
        if(res.destroyed)return;
        res.writeHead(200,{'Content-Type':'audio/wav','Cache-Control':'no-store','X-NPC-Voice-Provider':'local','X-Synthesis-Ms':String(audio.latencyMs)});
        res.end(audio.wav);
      }catch(error){if(!res.destroyed)json(res,503,(error instanceof Error?error.message:'Local voice unavailable')+' Text remains available.');}
      return;
    }
    if(!options.apiKey)return json(res,503,'Google TTS key not configured');
    if(busy||attempts>=20)return json(res,429,'Google voice busy or session allowance reached');
    busy=true;attempts++;
    try{
      const response=await(options.fetcher||fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model||'gemini-2.5-flash-preview-tts')}:generateContent`,{
        method:'POST',headers:{'x-goog-api-key':options.apiKey,'Content-Type':'application/json'},signal:AbortSignal.timeout(30000),
        body:JSON.stringify({contents:[{parts:[{text:`Read the following dialogue verbatim in a calm, warm voice:\n${text}`}]}],generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:'Kore'}}}}})});
      if(!response.ok)return json(res,response.status===429?429:502,`Google TTS failed (HTTP ${response.status}). Text remains available.`);
      const data=await response.json();
      const audio=data.candidates?.[0]?.content?.parts?.find((p:{inlineData?:unknown})=>p.inlineData)?.inlineData;
      if(!audio?.data||!/^audio\/L16/i.test(audio.mimeType||''))throw Error('Unsupported audio');
      const rate=Number(/rate=(\d+)/.exec(audio.mimeType)?.[1]||24000);
      if(![24000,48000,22050,16000].includes(rate))throw Error('Unsupported rate');
      res.writeHead(200,{'Content-Type':'audio/wav','Cache-Control':'no-store'});res.end(pcmToWav(Buffer.from(audio.data,'base64'),rate));
    }catch{return json(res,502,'Google voice timed out or returned invalid audio. Text remains available.');}
    finally{busy=false;}
  };
}
