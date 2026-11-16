import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createDecisionMiddleware, validateState, parseDecision } from '../server/decision';

const state = {npc:{x:0,z:-2,action:'PATROL',visited:[]},player:{x:0,z:8},lanternOn:false,request:'Follow me'};

test('decision schema rejects malformed states and model actions',() => {
  assert.throws(() => validateState({...state,player:{x:Infinity,z:0}}));
  assert.throws(() => validateState({...state,request:'a'.repeat(401)}));
  assert.throws(() => parseDecision({answers:{action:{choice:'DELETE'},reply:{choice:'WELCOME'}}}));
});

test('HTTP adapter keeps credentials server-side, forwards NPC schema, and enforces allowance',async () => {
  let calls = 0;
  const middleware = createDecisionMiddleware({apiKey:'test-server-key',limit:1,cooldownMs:0,
    fetcher: (async (_url,options) => {
      calls++;
      assert.equal((options?.headers as Record<string,string>)['x-goog-api-key'],'test-server-key');
      assert.equal(String(_url),'https://generativelanguage.googleapis.com/v1beta/decisions');
      const body=JSON.parse(options?.body as string);
      assert.equal(body.model,'gemini-decision-1');
      assert.ok(body.questions.action.criteria.FOLLOW_PLAYER);
      assert.equal(JSON.parse(body.input).request,'Follow me');
      return Response.json({answers:{action:{choice:'FOLLOW_PLAYER'},reply:{choice:'FOLLOW'}}});
    }) as typeof fetch});
  const server=createServer((req,res) => {void middleware(req,res,() => {res.writeHead(404);res.end();});});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try {
    const status=await (await fetch(url+'/api/npc/status')).text();
    assert.ok(!status.includes('test-server-key'));
    const post=(body: unknown,origin?:string) => fetch(url+'/api/npc/decision',{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
    assert.equal((await post(state,'https://untrusted.example')).status,403);
    assert.equal((await post({bad:true})).status,400);
    const result=await (await post(state)).json();
    assert.equal(result.action,'FOLLOW_PLAYER'); assert.equal(result.remaining,0);
    assert.equal((await post(state)).status,429); assert.equal(calls,1);
  } finally {server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));}
});
