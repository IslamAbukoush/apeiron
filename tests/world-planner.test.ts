import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createLocalThoughtMiddleware} from '../server/local-thought';
import {createGeneratedWorld} from '../src/game/generated-world';
import {generateWorld} from '../src/game/generation';

test('planner receives a bounded current-world catalog and rejects unsupported object capabilities',async()=>{
  const world=createGeneratedWorld(generateWorld('candy world','planner'));
  let invalid=false,calls=0;
  const middleware=createLocalThoughtMiddleware({fetcher:(async(_url,init)=>{
    calls++;const body=JSON.parse(init?.body as string),context=body.messages.at(-1).content;
    assert.match(context,/Sugarbloom Valley/);assert.match(context,/Giant cupcake/);assert.match(context,/Wooden bench/);
    const targetSchema=body.format.properties.plan.items.oneOf[1].properties.targetId;
    assert.ok(targetSchema.enum.includes('landmark'));assert.ok(targetSchema.enum.includes('bench'));assert.ok(targetSchema.enum.length<=12);
    return Response.json({message:{content:JSON.stringify({speech:'I will go to the cupcake.',plan:[invalid?{action:'INTERACT_OBJECT',targetId:'landmark',interaction:'toggle'}:{action:'GO_TO_OBJECT',targetId:'landmark'}]})}});
  }) as typeof fetch});
  const server=createServer((req,res)=>{void middleware(req,res,()=>res.end());});server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/npc/thought`;
  const state={npc:{x:0,z:-2,action:'WAIT',visited:[]},player:{x:0,z:8},request:'Visit the frosting monument',lanternOn:false,world:world.registry.snapshot()};
  const request=()=>fetch(url,{method:'POST',body:JSON.stringify(state)});
  try{
    const response=await request();assert.equal(response.status,200);const data=await response.json();assert.equal(data.worldId,state.world.id);assert.deepEqual(data.plan,[{action:'GO_TO_OBJECT',targetId:'landmark'}]);
    invalid=true;assert.equal((await request()).status,503);
    state.world.objects.push(state.world.objects[0]);assert.equal((await request()).status,400);assert.equal(calls,2);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));world.dispose();}
});
