import {stopWorker,cpuWorkerEnv} from './worker-process.ts';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createInterface} from 'node:readline';

export type Transcript={text:string;latencyMs:number};
export class LocalStt {
  private child?:ChildProcessWithoutNullStreams;
  private startup?:Promise<void>;
  private ready=false;
  private lastError?:string;
  private retryAfter=0;
  private sequence=0;
  private pending?:{id:number;accept:(value:Transcript)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>};
  private readonly python:string;
  constructor(private readonly root=process.cwd()){
    this.python=resolve(root,'.local-stt/venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  }
  status(){return {provider:'local',model:'nvidia/parakeet-tdt-0.6b-v2',runtime:'sherpa-onnx INT8 CPU',language:'en',ready:this.ready,error:this.lastError,
    configured:existsSync(this.python)&&['encoder.int8.onnx','decoder.int8.onnx','joiner.int8.onnx','tokens.txt'].every(file=>existsSync(resolve(this.root,'.local-stt/model',file)))};}
  start():Promise<void>{
    if(this.startup)return this.startup;
    if(Date.now()<this.retryAfter)return Promise.reject(Error(this.lastError||'Recognition is recovering. Try again shortly.'));
    if(!this.status().configured)return Promise.reject(Error('Local recognition is not installed. Run npm run stt:setup.'));
    this.startup=new Promise<void>((accept,reject)=>{
      const child=spawn(this.python,['-u',resolve(this.root,'server/local_stt.py')],{cwd:this.root,windowsHide:true,env:{...process.env,...cpuWorkerEnv,PYTHONIOENCODING:'utf-8'}});
      this.child=child;
      const fail=(error:Error)=>{this.lastError=error.message;this.retryAfter=Date.now()+15000;this.ready=false;this.startup=undefined;reject(error);if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(error);this.pending=undefined;}};
      const timer=setTimeout(()=>{stopWorker(child);fail(Error('Local recognition startup timed out.'));},60000);
      let memoryFailure=false;
      child.stderr.on('data',data=>{if(/bad allocation|Memory allocation|MemoryError/i.test(String(data)))memoryFailure=true;process.stderr.write(`[local recognition] ${data}`);});
      child.once('error',error=>{clearTimeout(timer);fail(error);});
      child.once('exit',()=>{clearTimeout(timer);if(this.child===child)this.child=undefined;fail(Error(memoryFailure?'Not enough system memory to load speech recognition. Close unused apps and try again in 15 seconds.':'Local recognition worker stopped.'));});
      createInterface({input:child.stdout}).on('line',line=>{
        try{
          const result=JSON.parse(line);if(result.ready){clearTimeout(timer);this.ready=true;this.lastError=undefined;this.retryAfter=0;accept();return;}
          const task=this.pending;if(!task||task.id!==result.id)return;
          this.pending=undefined;clearTimeout(task.timer);
          if(result.error || typeof result.text!=='string' || result.text.length>5000)return task.reject(Error('Local transcription failed.'));
          task.accept({text:result.text,latencyMs:result.latencyMs});
        }catch{stopWorker(child);fail(Error('Invalid recognition worker response.'));}
      });
    });
    return this.startup;
  }
  async transcribe(wav:Buffer):Promise<Transcript>{
    await this.start();if(this.pending)throw Error('Recognition is busy. Try again.');
    return new Promise((accept,reject)=>{
      const id=++this.sequence;
      const timer=setTimeout(()=>{this.pending=undefined;reject(Error('Local recognition timed out.'));},30000);
      this.pending={id,accept,reject,timer};
      this.child!.stdin.write(JSON.stringify({id,wav:wav.toString('base64')})+'\n',error=>{if(error){clearTimeout(timer);this.pending=undefined;reject(error);}});
    });
  }
  close(){stopWorker(this.child);}
}
