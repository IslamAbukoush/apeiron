import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createThoughtRouter} from '../server/thought-router';
test('provider choice routes status and inference independently without invoking the other provider',async()=>{
  const calls:string[]=[];
  const handler=(name:string)=>(req:any,res:any)=>{calls.push(name);res.end(JSON.stringify({provider:name,path:req.url}));};
  const router=createThoughtRouter({default:handler('default'),local:handler('local'),hybrid:handler('hybrid')});
  const server=createServer((req,res)=>void router(req,res,()=>{res.statusCode=404;res.end();}));server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${(server.address() as any).port}`;
  try{
    for(const path of ['/api/npc/thought/status','/api/npc/thought'])for(const provider of ['local','hybrid']){
      const r=await fetch(url+path,{method:path.endsWith('status')?'GET':'POST',headers:{'X-NPC-Provider':provider}});assert.equal((await r.json()).provider,provider);
    }
    assert.deepEqual(calls,['local','hybrid','local','hybrid']);
    assert.equal((await(await fetch(url+'/api/npc/thought/status')).json()).provider,'default');
    assert.equal((await fetch(url+'/api/npc/thought/status',{headers:{'X-NPC-Provider':'invalid'}})).status,400);
    assert.equal(calls.length,5);
    assert.equal((await fetch(url+'/api/npc/transcribe/status')).status,404);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
