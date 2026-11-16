import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('warm audio processor discards idle audio and flushes the last partial batch on release',()=>{
  const messages:any[]=[];let Processor:any;
  runInNewContext(readFileSync('src/ui/mic-worklet.js','utf8'),{
    AudioWorkletProcessor:class{port={onmessage:null,postMessage:(data:unknown)=>messages.push(data)};},
    registerProcessor:(_name:string,processor:unknown)=>{Processor=processor;},
  });
  const processor=new Processor(),samples=new Float32Array(128).fill(.5);
  processor.process([[samples]]);assert.equal(messages.length,0);
  processor.port.onmessage({data:{type:'start',id:1}});
  for(let i=0;i<5;i++)processor.process([[samples]]);
  assert.equal(messages.length,1);assert.equal(messages[0].samples.length,512);
  processor.port.onmessage({data:{type:'stop',id:1}});
  assert.equal(messages[1].samples.length,128);assert.equal(messages[2].type,'stopped');
  processor.process([[samples]]);assert.equal(messages.length,3);
  processor.port.onmessage({data:{type:'start',id:2}});processor.process([[samples]]);
  processor.port.onmessage({data:{type:'cancel'}});processor.process([[samples]]);assert.equal(messages.length,3);
});
