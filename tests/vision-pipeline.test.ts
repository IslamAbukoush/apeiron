import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createThoughtMiddleware} from '../server/thought';
import {caretakerInstruction} from '../server/npc-instructions';

test('ordinary object question forwards image bytes to Google and acknowledges receipt',async()=>{
  const jpeg=Buffer.from([255,216,255,217]).toString('base64');let calls=0;
  const middleware=createThoughtMiddleware({apiKey:'server-only-key',fetcher:(async(url,options)=>{
    calls++;assert.match(String(url),/gemini-3\.5-flash-lite:generateContent$/);
    const body=JSON.parse(options?.body as string);
    assert.equal(body.contents[0].parts[1].inlineData.data,jpeg);
    assert.equal(body.contents[0].parts[1].inlineData.mimeType,'image/jpeg');
    return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({speech:'The lantern is yellow.',plan:[]})}]}}]});
  }) as typeof fetch});
  const server=createServer((req,res)=>{void middleware(req,res,()=>{res.writeHead(404);res.end();});});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const r=await fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/api/npc/thought`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({voice:false,npc:{x:0,z:-2,action:'WAIT',visited:[]},player:{x:0,z:8},lanternOn:false,request:'What color is the lantern?',view:{image:'data:image/jpeg;base64,'+jpeg}})});
    assert.equal(r.headers.get('X-NPC-Vision'),'received');assert.equal(r.status,200);
    assert.equal((await r.json()).speech,'The lantern is yellow.');assert.equal(calls,1);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('scene questions keep visual context without requiring a walkable crosshair target',async()=>{
  const image='data:image/jpeg;base64,'+Buffer.from([255,216,255,217]).toString('base64');
  const targets=[undefined,{x:0,y:1.65,z:-2,name:'The caretaker',ground:false}];
  const middleware=createThoughtMiddleware({apiKey:'server-only-key',fetcher:(async(_url,options)=>{
    const body=JSON.parse(options?.body as string);
    const context=JSON.parse(body.contents[0].parts[0].text);
    assert.equal(context.state.request,'What do you see here?');
    assert.ok(!context.target || context.target.ground===false);
    assert.equal(body.systemInstruction.parts[0].text,caretakerInstruction(context.state.request));
    assert.match(body.systemInstruction.parts[0].text,/describe the whole visible scene/);
    assert.match(body.systemInstruction.parts[0].text,/This turn is conversation, not a movement command/);
    assert.ok(body.contents[0].parts[1].inlineData.data);
    return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({speech:'I see the courtyard and its lantern.',plan:[]})}]}}]});
  }) as typeof fetch});
  const server=createServer((req,res)=>{void middleware(req,res,()=>res.end());});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    for(const target of targets){
      const response=await fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/api/npc/thought`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({voice:false,npc:{x:0,z:-2,action:'WAIT',visited:[]},player:{x:0,z:8},lanternOn:false,request:'What do you see here?',view:{image,target}})});
      assert.equal(response.status,200);assert.equal(response.headers.get('X-NPC-Vision'),'received');
      assert.deepEqual((await response.json()).plan,[]);
    }
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  assert.match(caretakerInstruction('Stand there'),/This turn may contain an action request/);
});
