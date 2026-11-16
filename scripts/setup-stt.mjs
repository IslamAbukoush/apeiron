import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,createWriteStream,createReadStream} from 'node:fs';
import {writeFile,rename,unlink,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const root=resolve(import.meta.dirname,'..'),folder=resolve(root,'.local-stt'),models=resolve(folder,'model');
const repo='csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8';
const revision='84b478d541cdbf0c296a7ab5f1e20a6f8f998114';
const python=resolve(folder,'venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const run=(command,args)=>new Promise((accept,reject)=>{
  const child=spawn(command,args,{cwd:root,stdio:'inherit',windowsHide:true});
  child.once('error',reject);child.once('exit',code=>code===0?accept():reject(Error(`${command} exited ${code}`)));
});
mkdirSync(models,{recursive:true});
if(!existsSync(python))await run(process.env.PYTHON||'python',['-m','venv',resolve(folder,'venv')]);
await run(python,['-m','pip','install','-r','server/local-stt-requirements.txt']);
const metadata=await(await fetch(`https://huggingface.co/api/models/${repo}/revision/${revision}?blobs=true`)).json();
const files=['encoder.int8.onnx','decoder.int8.onnx','joiner.int8.onnx','tokens.txt'];
async function verified(path,file){
  if(!file)return false;
  const hash=createHash(file.lfs?'sha256':'sha1');
  if(!file.lfs)hash.update(`blob ${(await stat(path)).size}\0`);
  for await(const data of createReadStream(path))hash.update(data);
  return hash.digest('hex')===(file.lfs?.sha256||file.blobId);
}
for(const name of files){
  const target=resolve(models,name),file=metadata.siblings.find(file=>file.rfilename===name);
  if(existsSync(target) && await verified(target,file))continue;
  console.log(`Downloading Parakeet ${name}…`);
  const response=await fetch(`https://huggingface.co/${repo}/resolve/${revision}/${name}`);
  if(!response.ok)throw Error(`Download failed: ${name}`);
  const temporary=target+'.download';await pipeline(Readable.fromWeb(response.body),createWriteStream(temporary));
  if(!await verified(temporary,file)){await unlink(temporary);throw Error(`Checksum mismatch: ${name}`);}
  await rename(temporary,target);
}
await writeFile(resolve(folder,'model-source.json'),JSON.stringify({original:'nvidia/parakeet-tdt-0.6b-v2',export:repo,revision,files},null,2));
await run(python,['-c',"import sys; sys.path.insert(0,'server'); from local_stt import load_recognizer; load_recognizer(); print('Local Parakeet speech recognition is ready.')"]);
console.log('Start npm run dev. Hold V or the Hold to talk button, then release to send.');
