import {test,expect} from './fixtures';

test('NPC voice renders in the correct ear, follows listener rotation and fades with distance',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Enter original playground'}).click();
  const result=await page.evaluate(async()=>{
    const {GoogleVoice}=await import('/src/ui/google-voice.ts');
    const voice=new GoogleVoice(document.createElement('div'));
    const origin={x:0,y:0,z:0},forward={x:0,y:0,z:-1},up={x:0,y:1,z:0};
    voice.setSpatialPose(origin,forward,up,{x:4,y:0,z:-1});voice.beginStream();
    const context:AudioContext=(voice as any).context;
    await context.resume();
    const output:GainNode=(voice as any).distanceGain,split=context.createChannelSplitter(2),mute=context.createGain();mute.gain.value=0;
    const left=context.createAnalyser(),right=context.createAnalyser();
    output.disconnect();output.connect(split);split.connect(left,0);split.connect(right,1);left.connect(mute);right.connect(mute);mute.connect(context.destination);
    const raw=new Uint8Array(24000*6*2);
    for(let i=0;i<raw.length/2;i++){const sample=Math.round((Math.sin(i*2*Math.PI*440/24000)+Math.sin(i*2*Math.PI*1300/24000))*.2*32767);raw[i*2]=sample&255;raw[i*2+1]=(sample>>8)&255;}
    let binary='';for(let i=0;i<raw.length;i+=8192)binary+=String.fromCharCode(...raw.subarray(i,i+8192));
    voice.chunk(btoa(binary));
    const measure=async()=>{await new Promise(r=>setTimeout(r,300));const rms=(analyser:AnalyserNode)=>{const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);return Math.sqrt(values.reduce((sum,v)=>sum+v*v,0)/values.length);};return {left:rms(left),right:rms(right)};};
    try{
      const onRight=await measure();
      voice.setSpatialPose(origin,forward,up,{x:-4,y:0,z:-1});const onLeft=await measure();
      voice.setSpatialPose(origin,{x:0,y:0,z:1},up,{x:4,y:0,z:-1});const turned=await measure();
      voice.setSpatialPose(origin,forward,up,{x:40,y:0,z:-10});const far=await measure();
      voice.setSpatialPose({x:0,y:0,z:60},forward,up,{x:4,y:0,z:-1});const beyondRange=await measure();
      voice.stop();const activeSources=(voice as any).sources.size,stopped=await measure();
      voice.dispose();await new Promise(r=>setTimeout(r,10));
      return {onRight,onLeft,turned,far,beyondRange,stopped,activeSources,contextState:context.state};
    }finally{voice.dispose();}
  });
  expect(result.onRight.right).toBeGreaterThan(.01);
  expect(result.onRight.right).toBeGreaterThan(result.onRight.left*1.5);
  expect(result.onLeft.left).toBeGreaterThan(result.onLeft.right*1.5);
  expect(result.turned.left).toBeGreaterThan(result.turned.right*1.5);
  const near=result.onRight.left+result.onRight.right;
  expect(result.far.left+result.far.right).toBeLessThan(near*.25);
  expect(result.beyondRange.left+result.beyondRange.right).toBeLessThan(near*.005);
  expect(result.stopped.left+result.stopped.right).toBeLessThan(near*.005);
  expect(result.activeSources).toBe(0);expect(result.contextState).toBe('closed');
});

test('generated speech uses the NPC panner and listener follows the player camera',async({page})=>{
  await page.addInitScript(()=>{
    const create=AudioContext.prototype.createPanner;
    AudioContext.prototype.createPanner=function(){const node=create.call(this);(window as any).voicePanner=node;(window as any).voiceContext=this;return node;};
    const connect=AudioNode.prototype.connect;
    (AudioNode.prototype as any).connect=function(target:any,...args:any[]){if(this instanceof MediaElementAudioSourceNode)(window as any).mediaVoiceDestination=target;return (connect as any).call(this,target,...args);};
  });
  await page.route('**/api/npc/status',r=>r.fulfill({json:{configured:false}}));
  await page.route('**/api/npc/thought/status',r=>r.fulfill({json:{configured:true}}));
  await page.route('**/api/npc/thought',r=>r.fulfill({json:{speech:'You can hear me here.',plan:[]}}));
  await page.goto('/');await page.locator('#voice-engine').selectOption('paradee');await expect(page.locator('#npc-llm')).toBeChecked();await page.locator('#npc-voice').check();await page.getByRole('button',{name:'Enter original playground'}).click();
  await page.keyboard.press('KeyT');await page.locator('#chat-input').fill('Hello');await page.getByRole('button',{name:'Send message'}).click();
  await expect(page.locator('#voice-status audio')).toHaveCount(1,{timeout:15000});
  const position=()=>page.evaluate(()=>{const p=(window as any).voicePanner as PannerNode,c=(window as any).voiceContext as AudioContext;return {sourceX:p.positionX.value,sourceZ:p.positionZ.value,sourceY:p.positionY.value,listenerZ:c.listener.positionZ.value,linked:(window as any).mediaVoiceDestination===p,model:p.panningModel,rolloff:p.rolloffFactor};});
  const before=await position();expect(before.linked).toBe(true);expect(before.model).toBe('HRTF');expect(before.sourceY).toBeCloseTo(1.55,1);
  expect(before.sourceX).toBeCloseTo(Number(await page.locator('#npc-status').getAttribute('data-x')),1);
  expect(before.sourceZ).toBeCloseTo(Number(await page.locator('#npc-status').getAttribute('data-z')),1);
  await page.keyboard.down('KeyS');
  try{await expect.poll(async()=>Math.abs((await position()).listenerZ-before.listenerZ)).toBeGreaterThan(1);}finally{await page.keyboard.up('KeyS');}
});
