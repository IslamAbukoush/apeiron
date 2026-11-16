import {test} from 'node:test';import assert from 'node:assert/strict';
import {Box3,Vector3} from 'three';import {createWorld} from '../src/game/world';import {createGeneratedWorld} from '../src/game/generated-world';import {generateWorld} from '../src/game/generation';import {Caretaker} from '../src/game/npc';import {validateWorld} from '../server/world-state';
const image='data:image/jpeg;base64,/9j/2Q==';
test('visual questions wait for approach and a fresh NPC-eye image before calling the model',async()=>{
  const world=createWorld(),player=new Vector3(0,0,8),calls:any[]=[];let shots=0;
  const npc=new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp,(async(_,init)=>{calls.push(JSON.parse(init!.body as string));return Response.json({speech:'Those flowers look thirsty.',plan:[]});}) as typeof fetch,world.registry);
  npc.llmEnabled=true;npc.onLookReady=()=>{shots++;return {image,perspective:'npc'};};
  const object=world.registry.get('flowerbed')!,start=world.npc.position.clone();
  const pending=npc.command('What is this?',player,{image,target:{...object.position,y:.5,name:object.name,ground:false,objectId:object.id}});
  assert.equal(calls.length,0);assert.equal(npc.thinking,true);
  for(let frame=0;frame<800&&!shots;frame++)npc.step(.1,player);
  await pending;assert.equal(shots,1);assert.equal(calls.length,1);assert.equal(calls[0].view.perspective,'npc');assert.ok(world.npc.position.distanceTo(start)>3);assert.equal(npc.action,'WAIT');
  assert.match(npc.speech,/flowers/);npc.dispose();world.dispose();
});
test('blocked observation never sends the player screenshot, and a newer command cancels the pending look',async()=>{
  for(const cancel of [false,true]){
    const world=createWorld(),player=new Vector3(0,0,8),calls:any[]=[];
    const obstacles=cancel?world.navigationColliders:[...world.navigationColliders,new Box3(new Vector3(1,0,9),new Vector3(5,5,13))];
    const npc=new Caretaker(world.npc,world.npcCollider,obstacles,world.lamp,(async(_,init)=>{calls.push(JSON.parse(init!.body as string));return Response.json({speech:'I cannot get a clear view from here.',plan:[]});}) as typeof fetch,world.registry);npc.llmEnabled=true;
    const object=world.registry.get('flowerbed')!;
    const pending=npc.command('What is this?',player,{image,target:{...object.position,y:.5,name:object.name,ground:false,objectId:object.id}});
    if(cancel){await npc.command('Stop',player);await pending;assert.equal(calls.length,1);assert.equal(calls[0].request,'Stop');}
    else{for(let frame=0;frame<800&&!calls.length;frame++)npc.step(.1,player);await pending;assert.equal(calls[0].view.image,undefined);assert.equal(calls[0].npc.execution.status,'blocked');}
    npc.dispose();world.dispose();
  }
});
test('all worlds offer reachable bell, garden and treasure interactions with real state changes',async()=>{
  for(const theme of ['', 'candy','forest','desert','frozen','volcanic','cosmic']){
    const world=theme?createGeneratedWorld(generateWorld(theme+' world','activities-test')):createWorld();assert.ok(validateWorld(world.registry.snapshot()));
    const npc=new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp,undefined,world.registry),player=new Vector3(18,0,18);
    for(const [request,id,state] of [['Ring the bell','bell','rung 1'],['Water the flowers','flowerbed','watered'],['Open the chest','treasure-chest','open'],['Open the chest','treasure-chest','open'],['Close the chest','treasure-chest','closed']]){
      await npc.command(request,player);assert.equal(npc.action,'INTERACT_OBJECT',`${theme}: ${request}: ${npc.activity}`);
      for(let i=0;i<800&&npc.action!=='WAIT';i++){npc.step(.1,player);world.activities.update(.1);}
      assert.equal(npc.execution?.status,'completed',`${theme} ${request}`);assert.ok(world.registry.get(id)!.state.startsWith(state),world.registry.get(id)!.state);
    }
    npc.dispose();world.dispose();
  }
});
test('a past blocked task does not prevent a new reachable scene observation',async()=>{
  const world=createWorld(),player=new Vector3(0,0,8);let shots=0;
  const npc=new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp,(async()=>Response.json({speech:'A clear stretch of the path.',plan:[]})) as typeof fetch,world.registry);
  npc.llmEnabled=true;npc.execution={step:'MOVE_TO_TARGET',status:'blocked',detail:'Previous destination was blocked.'};npc.onLookReady=()=>{shots++;return {image};};
  const pending=npc.command('What do you see here?',player,{image,target:{x:1,y:0,z:1,name:'World ground',ground:true}});
  for(let i=0;i<300&&!shots;i++)npc.step(.1,player);await pending;
  assert.equal(shots,1);assert.notEqual(npc.execution?.status,'blocked');npc.dispose();world.dispose();
});
