import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {validateSpeechWav,createSttMiddleware} from '../server/stt';
import {encodePcmWav} from '../src/ui/audio-pcm';

test('microphone WAV encoding clips samples and matches the recognition format',()=>{
  const samples=new Float32Array(1600);samples.set([-2,-1,0,1,2]);
  const wav=Buffer.from(encodePcmWav(samples));validateSpeechWav(wav);
  assert.equal(wav.readUInt32LE(24),16000);assert.equal(wav.readUInt32LE(40),3200);
  assert.equal(wav.readInt16LE(44),-32768);assert.equal(wav.readInt16LE(52),32767);
  assert.throws(()=>validateSpeechWav(wav.subarray(0,100)));
  assert.throws(()=>validateSpeechWav(Buffer.from(encodePcmWav(samples,48000))));
  assert.throws(()=>validateSpeechWav(Buffer.from(encodePcmWav(new Float32Array(480001)))));
  assert.throws(()=>validateSpeechWav(Buffer.from(encodePcmWav(new Float32Array(1599)))));
});

test('local transcription validates uploads and returns text without an API key',async()=>{
  const wav=Buffer.from(encodePcmWav(new Float32Array(1600)));let calls=0;
  const middleware=createSttMiddleware({status:()=>({provider:'local',model:'nvidia/parakeet-tdt-0.6b-v2',runtime:'CPU',language:'en',ready:true,configured:true}),transcribe:async input=>{
    calls++;assert.deepEqual(input,wav);return {text:'Follow me.',latencyMs:90};
  }});
  const server=createServer((req,res)=>{void middleware(req,res,()=>{res.writeHead(404);res.end();});});server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try{
    assert.equal((await(await fetch(url+'/api/npc/transcribe/status')).json()).configured,true);
    const response=await fetch(url+'/api/npc/transcribe',{method:'POST',headers:{'Content-Type':'audio/wav'},body:wav});
    assert.equal(response.status,200);assert.equal((await response.json()).text,'Follow me.');
    const foreign=await fetch(url+'/api/npc/transcribe',{method:'POST',headers:{'Content-Type':'audio/wav',Origin:'https://other.example'},body:wav});assert.equal(foreign.status,403);
    const invalid=await fetch(url+'/api/npc/transcribe',{method:'POST',headers:{'Content-Type':'audio/wav'},body:'invalid'});assert.equal(invalid.status,400);
    const wrongType=await fetch(url+'/api/npc/transcribe',{method:'POST',headers:{'Content-Type':'audio/webm'},body:wav});assert.equal(wrongType.status,415);
    assert.equal(calls,1);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
