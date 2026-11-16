import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,createReadStream,createWriteStream} from 'node:fs';
import {writeFile,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

if(process.platform!=='win32')throw Error('This portable setup targets Windows. Install Ollama for your OS and serve it on 127.0.0.1:11435.');
const root=resolve(import.meta.dirname,'..'),folder=resolve(root,'.local-llm');
const version='v0.40.16',name='ollama-windows-amd64.zip';
const base=`https://github.com/ollama/ollama/releases/download/${version}`;
const archive=resolve(folder,'ollama.zip'),executable=resolve(folder,'ollama/ollama.exe');
mkdirSync(folder,{recursive:true});
const run=(command,args,env=process.env)=>new Promise((accept,reject)=>{
  const child=spawn(command,args,{cwd:root,env,windowsHide:true,stdio:'inherit'});
  child.once('error',reject);child.once('exit',code=>code===0?accept():reject(Error(`${command} exited ${code}`)));
});
if(!existsSync(executable)){
  if(!existsSync(archive)){
    console.log('Downloading the official portable Ollama CUDA runtime…');
    const response=await fetch(`${base}/${name}`);if(!response.ok)throw Error('Runtime download failed');
    await pipeline(Readable.fromWeb(response.body),createWriteStream(archive));
  }
  const checks=await(await fetch(`${base}/sha256sum.txt`)).text();
  const expected=checks.split('\n').find(line=>line.trim().endsWith(name))?.split(/\s+/)[0];
  const hash=createHash('sha256');for await(const data of createReadStream(archive))hash.update(data);
  if(!expected || hash.digest('hex')!==expected)throw Error('Ollama archive checksum failed; remove .local-llm/ollama.zip and run setup again.');
  console.log('Verified Ollama archive. Extracting…');
  await run(process.env.PYTHON||'python',['-c','import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',archive,resolve(folder,'ollama')]);
  await unlink(archive);
}
const env={...process.env,OLLAMA_HOST:'127.0.0.1:11435',OLLAMA_MODELS:resolve(folder,'models'),OLLAMA_NO_CLOUD:'1',OLLAMA_NUM_PARALLEL:'1',OLLAMA_MAX_LOADED_MODELS:'1',OLLAMA_CONTEXT_LENGTH:'4096',OLLAMA_FLASH_ATTENTION:'1'};
let child;
try{
  let existing=false;
  try{existing=(await fetch('http://127.0.0.1:11435/api/version',{signal:AbortSignal.timeout(500)})).ok;}catch{}
  if(!existing){
    child=spawn(executable,['serve'],{cwd:root,env,windowsHide:true,stdio:'ignore'});
    let started=false;
    for(let i=0;i<100;i++){
      try{started=(await fetch('http://127.0.0.1:11435/api/version',{signal:AbortSignal.timeout(500)})).ok;}catch{}
      if(started)break;await new Promise(resolve=>setTimeout(resolve,200));
    }
    if(!started)throw Error('Ollama did not start.');
  }
  console.log('Downloading Qwen3.5-2B Q4_K_M with vision support…');
  await run(executable,['pull','qwen3.5:2b-q4_K_M'],env);
  console.log('Initializing CUDA and warming the first reply. First-time driver compilation can take a few minutes…');
  const warm=await fetch('http://127.0.0.1:11435/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({model:'qwen3.5:2b-q4_K_M',prompt:'Say hello in one word.',think:false,stream:false,keep_alive:'10m',options:{num_ctx:4096,num_batch:128,num_predict:8}}),signal:AbortSignal.timeout(240000)});
  if(!warm.ok)throw Error('Local model warm-up failed.');await warm.json();
  await writeFile(resolve(folder,'installed.json'),JSON.stringify({runtime:version,model:'qwen3.5:2b-q4_K_M'},null,2));
  console.log('Local model installed. Run npm run dev; conversation and vision now work without an API key.');
}finally{
  if(child?.pid)await run('taskkill',['/PID',String(child.pid),'/T','/F']);
}
