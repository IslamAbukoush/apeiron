import {spawn} from 'node:child_process';
import {existsSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const folder=resolve(root,'.local-tts');
const python=resolve(folder,'venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const run=(command,args,env=process.env)=>new Promise((accept,reject)=>{
  const child=spawn(command,args,{cwd:root,env,stdio:'inherit',windowsHide:true});
  child.once('error',reject);child.once('exit',code=>code===0?accept():reject(Error(`${command} exited ${code}`)));
});
mkdirSync(folder,{recursive:true});
if(!existsSync(python))await run(process.env.PYTHON||'python',['-m','venv',resolve(folder,'venv')]);
await run(python,['-m','pip','install','-r','server/local-tts-requirements.txt']);
await run(python,['-c',"from paradee import Paradee; tts=Paradee(threads=1); audio=tts('Welcome to the courtyard.',voice='am_puck'); print(f'Local voice ready: {len(audio)/24000:.2f} seconds of audio')"],{
  ...process.env,HF_HOME:resolve(folder,'cache'),PYTHONIOENCODING:'utf-8',
});
console.log('Paradee installed. Start the game with npm run dev; enable NPC voice replies.');
