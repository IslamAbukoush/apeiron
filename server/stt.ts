import type {IncomingMessage,ServerResponse} from 'node:http';
import type {LocalStt} from './local-stt.ts';

/** Restrict uploaded audio to the exact bounded PCM format produced by the microphone. */
export function validateSpeechWav(wav:Buffer):void {
  if(wav.length<44||wav.length>1000000||wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE'||wav.readUInt32LE(4)+8!==wav.length)throw Error('Invalid WAV');
  let format=false,frames=0;
  for(let offset=12;offset+8<=wav.length;){
    const name=wav.toString('ascii',offset,offset+4),size=wav.readUInt32LE(offset+4),start=offset+8;
    if(start+size>wav.length)throw Error('Truncated WAV');
    if(name==='fmt '){
      if(size<16||wav.readUInt16LE(start)!==1||wav.readUInt16LE(start+2)!==1||wav.readUInt32LE(start+4)!==16000||wav.readUInt32LE(start+8)!==32000||wav.readUInt16LE(start+12)!==2||wav.readUInt16LE(start+14)!==16)throw Error('Expected mono 16 kHz PCM');
      format=true;
    }
    if(name==='data'){if(frames||size%2)throw Error('Invalid PCM data');frames=size/2;}
    offset=start+size+(size%2);
  }
  if(!format||frames<1600||frames>480000)throw Error('Expected 0.1 to 30 seconds of speech');
}

export function createSttMiddleware(stt:Pick<LocalStt,'status'|'transcribe'>){
  const send=(res:ServerResponse,status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  return async(req:IncomingMessage,res:ServerResponse,next:()=>void)=>{
    if(req.url==='/api/npc/transcribe/status')return send(res,200,stt.status());
    if(req.url!=='/api/npc/transcribe')return next();
    if(req.method!=='POST')return send(res,405,{error:'POST required'});
    if(req.headers.origin && ![`http://${req.headers.host}`,`https://${req.headers.host}`].includes(req.headers.origin))return send(res,403,{error:'Origin not allowed'});
    if(req.headers['content-type']?.split(';')[0]!=='audio/wav')return send(res,415,{error:'Expected audio/wav'});
    let wav:Buffer;
    try{
      const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1000000)throw Error('Audio too large');chunks.push(Buffer.from(chunk));}
      wav=Buffer.concat(chunks);validateSpeechWav(wav);
    }catch{return send(res,400,{error:'Use 0.1 to 30 seconds of mono 16 kHz PCM audio.'});}
    try{const result=await stt.transcribe(wav);if(!res.destroyed)send(res,200,{...result,provider:'local',model:'parakeet-tdt-0.6b-v2'});}
    catch(error){if(!res.destroyed)send(res,503,{error:error instanceof Error?error.message:'Local recognition unavailable.'});}
  };
}
