import {spawn,type ChildProcess} from 'node:child_process';
import {existsSync,createWriteStream} from 'node:fs';
import {resolve} from 'node:path';

export const LOCAL_MODEL='qwen3.5:2b-q4_K_M';
export const LOCAL_URL='http://127.0.0.1:11435';

/** Project-owned, loopback-only Ollama. Existing unrelated installations stay independent. */
export class LocalLlm {
  private child?:ChildProcess;
  private starting?:Promise<void>;
  constructor(private readonly root=process.cwd()){}
  start():Promise<void>{
    if(this.starting)return this.starting;
    this.starting=this.launch().finally(()=>{this.starting=undefined;});return this.starting;
  }
  private async launch(){
    try{const r=await fetch(LOCAL_URL+'/api/version',{signal:AbortSignal.timeout(500)});if(r.ok)return;}catch{/* Start the project's runtime. */}
    const executable=resolve(this.root,'.local-llm/ollama/ollama.exe');
    if(!existsSync(executable))throw Error('Local LLM is not installed. Run npm run llm:setup.');
    const log=createWriteStream(resolve(this.root,'.local-llm/ollama.log'),{flags:'a'});
    const child=spawn(executable,['serve'],{cwd:this.root,windowsHide:true,env:{...process.env,
      OLLAMA_HOST:'127.0.0.1:11435',OLLAMA_MODELS:resolve(this.root,'.local-llm/models'),OLLAMA_NO_CLOUD:'1',
      OLLAMA_NUM_PARALLEL:'1',OLLAMA_MAX_LOADED_MODELS:'1',OLLAMA_CONTEXT_LENGTH:'4096',OLLAMA_KEEP_ALIVE:'10m',
      CUDA_CACHE_MAXSIZE:'2147483648',OLLAMA_FLASH_ATTENTION:'1',
    },stdio:['ignore','pipe','pipe']});
    this.child=child;child.stdout?.pipe(log);child.stderr?.pipe(log);
    let failure:Error|undefined;child.once('error',error=>{failure=error;});
    child.once('exit',()=>{log.end();if(this.child===child){this.child=undefined;this.starting=undefined;}failure=Error('Local LLM stopped; see .local-llm/ollama.log.');});
    for(let attempt=0;attempt<100;attempt++){
      if(failure)throw failure;
      try{const r=await fetch(LOCAL_URL+'/api/version',{signal:AbortSignal.timeout(500)});if(r.ok)return;}catch{/* Wait for startup. */}
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    this.close();throw Error('Local LLM startup timed out.');
  }
  async status(model=LOCAL_MODEL){
    try{
      await this.start();const r=await fetch(LOCAL_URL+'/api/tags',{signal:AbortSignal.timeout(2000)});
      const data=await r.json();return {provider:'local',model,configured:r.ok && data.models?.some((m:{name:string})=>m.name===model),remaining:null};
    }catch{return {provider:'local',model,configured:false,remaining:null,error:'Run npm run llm:setup to install local conversation.'};}
  }
  async warm(model=LOCAL_MODEL,context=4096){
    await this.start();const r=await fetch(LOCAL_URL+'/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model,prompt:'Say hello in one word.',think:false,stream:false,keep_alive:'10m',options:{num_ctx:context,num_batch:128,num_predict:8}}),signal:AbortSignal.timeout(180000)});
    if(!r.ok)throw Error('Local model is not ready. Run npm run llm:setup.');
  }
  close(){
    const child=this.child;if(!child?.pid)return;
    if(process.platform==='win32')spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
    else child.kill();
  }
}
