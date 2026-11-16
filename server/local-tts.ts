import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createInterface} from 'node:readline';

export type LocalAudio={wav:Buffer;latencyMs:number;durationMs:number};

/** Keep the small model warm. No GPU, cloud requests or per-utterance Python startup. */
export class LocalTts {
  private child?:ChildProcessWithoutNullStreams;
  private startup?:Promise<void>;
  private ready=false;
  private id=0;
  private pending=new Map<number,{resolve:(audio:LocalAudio)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private readonly python:string;
  constructor(private readonly root=process.cwd(),private readonly voice='am_puck'){
    this.python=resolve(root,'.local-tts','venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  }
  status(){return {provider:'local',model:'Paradee-8M-v1.3',voice:this.voice,configured:existsSync(this.python),ready:this.ready};}
  start():Promise<void>{
    if(this.startup)return this.startup;
    if(!existsSync(this.python))return Promise.reject(Error('Local voice is not installed. Run npm run tts:setup.'));
    this.startup=new Promise<void>((accept,reject)=>{
      const child=spawn(this.python,['-u',resolve(this.root,'server/local_tts.py')],{
        cwd:this.root,windowsHide:true,env:{...process.env,HF_HOME:resolve(this.root,'.local-tts/cache'),HF_HUB_OFFLINE:'1',PYTHONIOENCODING:'utf-8',PARADEE_VOICE:this.voice},
      });
      this.child=child;
      const fail=(error:Error)=>{this.ready=false;this.startup=undefined;reject(error);for(const task of this.pending.values()){clearTimeout(task.timer);task.reject(error);}this.pending.clear();};
      const timer=setTimeout(()=>{child.kill();fail(Error('Local voice startup timed out. Run npm run tts:setup to finish downloads.'));},120000);
      child.stderr.on('data',data=>process.stderr.write(`[local voice] ${data}`));
      child.once('error',error=>{clearTimeout(timer);fail(error);});
      child.once('exit',()=>{clearTimeout(timer);if(this.child===child)this.child=undefined;fail(Error('Local voice worker stopped.'));});
      createInterface({input:child.stdout}).on('line',line=>{
        try{
          const result=JSON.parse(line);
          if(result.ready){clearTimeout(timer);this.ready=true;accept();return;}
          const task=this.pending.get(result.id);if(!task)return;
          this.pending.delete(result.id);clearTimeout(task.timer);
          if(result.error)return task.reject(Error(result.error));
          const wav=Buffer.from(result.wav,'base64');
          if(wav.length<44 || wav.toString('ascii',0,4)!=='RIFF')return task.reject(Error('Invalid local audio'));
          task.resolve({wav,latencyMs:result.latencyMs,durationMs:result.durationMs});
        }catch{child.kill();fail(Error('Invalid local voice worker response'));}
      });
    });
    return this.startup;
  }
  async synthesize(text:string):Promise<LocalAudio>{
    await this.start();
    if(this.pending.size>=2)throw Error('Local voice is busy');
    const id=++this.id;
    return new Promise((accept,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Local voice timed out'));},30000);
      this.pending.set(id,{resolve:accept,reject,timer});
      this.child!.stdin.write(JSON.stringify({id,text})+'\n',error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(error);}});
    });
  }
  close(){this.child?.kill();}
}
