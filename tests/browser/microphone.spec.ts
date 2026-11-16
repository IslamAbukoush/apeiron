import {test,expect} from '@playwright/test';
import {resolve} from 'node:path';

test.use({permissions:['microphone'],launchOptions:{args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-audio-capture=${resolve('tests/fixtures/follow-me.wav')}`]}});

async function enter(page:import('@playwright/test').Page,voice=false,controlled=false){
  await page.route('**/api/npc/status',route=>route.fulfill({json:{configured:false}}));
  await page.addInitScript((controlled)=>{
    const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    (window as any).microphoneTracks=[];
    (window as any).microphoneSamples=[];
    const OriginalWorklet=window.AudioWorkletNode;
    window.AudioWorkletNode=class extends OriginalWorklet{
      constructor(context:BaseAudioContext,name:string,options?:AudioWorkletNodeOptions){
        super(context,name,options);this.port.addEventListener('message',({data})=>{if(data.type==='samples')(window as any).microphoneSamples.push(performance.now());});
      }
    };
    document.addEventListener('keydown',event=>{if(event.code==='KeyV'&&!event.repeat)(window as any).microphoneStart=performance.now();});
    navigator.mediaDevices.getUserMedia=async constraints=>{
      let stream:MediaStream;
      if(controlled){
        const context=new AudioContext(),destination=context.createMediaStreamDestination();
        const buffer=await context.decodeAudioData(await(await fetch('/tests/fixtures/follow-me.wav')).arrayBuffer());
        await context.resume();stream=destination.stream;
        (window as any).playMicrophoneFixture=()=>{const source=context.createBufferSource();source.buffer=buffer;source.connect(destination);source.start();};
      }else stream=await original(constraints);
      (window as any).microphoneTracks.push(...stream.getTracks());return stream;
    };
  },controlled);
  await page.goto('/');if(controlled)await page.locator('#npc-provider').selectOption('local');if(voice)await page.locator('#npc-voice').check();await page.getByRole('button',{name:'Enter original playground'}).click();
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#chat-mic')).toHaveAttribute('data-ready','true');
}

test('hold microphone button, release, and run a real Parakeet command through the NPC',async({page})=>{
  const status=await(await page.request.get('/api/npc/transcribe/status')).json();
  test.skip(!status.configured,'Run npm run stt:setup to install Parakeet.');
  let transcriptions=0;
  page.on('request',request=>{if(request.url().endsWith('/api/npc/transcribe'))transcriptions++;});
  await enter(page,false,true);await page.keyboard.press('KeyT');
  const button=page.locator('#chat-mic');await expect(button).toBeEnabled();
  const box=(await button.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await expect(button).toHaveAttribute('aria-pressed','true');await expect(page.locator('#mic-status')).toContainText('Listening');
  await page.evaluate(()=>(window as any).playMicrophoneFixture());
  await page.waitForTimeout(1800);expect(transcriptions).toBe(0);
  await page.mouse.up();
  await expect(page.locator('#mic-status')).toContainText(/Heard:.*follow me/i,{timeout:20000});
  await expect(page.locator('#chat-history')).toContainText(/You:.*follow me/i);
  await expect(page.locator('#npc-status')).toHaveAttribute('data-action','FOLLOW_PLAYER',{timeout:20000});
  await expect(page.locator('#npc-status')).toContainText('Local LLM',{timeout:20000});
  expect(await page.locator('#chat-history p').filter({hasText:/^Caretaker: /}).count()).toBeLessThanOrEqual(1);
  expect(transcriptions).toBe(1);await expect(button).toHaveAttribute('aria-pressed','false');
  expect(await page.evaluate(()=>(window as any).microphoneTracks.length)).toBe(1);
  expect(await page.evaluate(()=>(window as any).microphoneTracks.every((track:MediaStreamTrack)=>track.readyState==='live'))).toBe(true);
  await page.screenshot({path:'artifacts/microphone-npc.png'});
});

test('V keeps the mouse captured, blocks repeats, and records immediately using the warm microphone',async({page})=>{
  await page.route('**/api/npc/transcribe/status',route=>route.fulfill({json:{configured:true}}));
  await page.route('**/api/npc/transcribe',route=>route.fulfill({json:{text:'Hello.',latencyMs:10}}));
  await page.route('**/api/npc/thought',route=>route.fulfill({json:{speech:'Hello.',plan:[],provider:'local'}}));
  await enter(page);await page.waitForTimeout(200);
  expect(await page.evaluate(()=>(window as any).microphoneSamples.length)).toBe(0);
  for(let turn=0;turn<2;turn++){
    await page.evaluate(()=>{(window as any).microphoneSamples=[];});
    await page.keyboard.down('KeyV');await page.keyboard.down('KeyV');await page.keyboard.down('KeyV');
    await expect(page.locator('#chat-mic')).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('#chat-input')).not.toBeFocused();await expect(page.locator('#chat-input')).toHaveValue('');
    expect(await page.evaluate(()=>document.pointerLockElement?.id)).toBe('viewport');
    await expect.poll(()=>page.evaluate(()=>(window as any).microphoneSamples.length)).toBeGreaterThan(0);
    expect(await page.evaluate(()=>(window as any).microphoneSamples[0]-(window as any).microphoneStart)).toBeLessThan(150);
    await page.waitForTimeout(1400);await page.keyboard.up('KeyV');
    await expect(page.locator('#mic-status')).toContainText('Heard: Hello.');
    expect(await page.evaluate(()=>document.pointerLockElement?.id)).toBe('viewport');
    expect(await page.evaluate(()=>(window as any).microphoneTracks.length)).toBe(1);
    const count=await page.evaluate(()=>(window as any).microphoneSamples.length);
    await page.waitForTimeout(150);expect(await page.evaluate(()=>(window as any).microphoneSamples.length)).toBe(count);
  }
});

test('holding V records; Escape stops the microphone without sending audio',async({page})=>{
  let transcriptions=0;
  await page.route('**/api/npc/transcribe/status',route=>route.fulfill({json:{configured:true}}));
  page.on('request',request=>{if(request.url().endsWith('/api/npc/transcribe'))transcriptions++;});
  await enter(page);await page.keyboard.down('KeyV');
  await expect(page.locator('#mic-status')).toContainText('Listening');
  await page.keyboard.press('Escape');await page.keyboard.up('KeyV');
  await expect(page.locator('#chat-mic')).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('#mic-status')).toContainText('cancelled');
  expect(await page.evaluate(()=>(window as any).microphoneTracks.every((track:MediaStreamTrack)=>track.readyState==='ended'))).toBe(true);
  expect(transcriptions).toBe(0);
});

test('microphone permission errors are visible and leave chat usable',async({page})=>{
  await page.route('**/api/npc/transcribe/status',route=>route.fulfill({json:{configured:true}}));
  await page.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError');};});
  await page.goto('/');await page.getByRole('button',{name:'Enter original playground'}).click();await expect(page.locator('#hud')).toBeVisible();
  await page.keyboard.down('KeyV');await expect(page.locator('#mic-status')).toContainText('Microphone access denied');await page.keyboard.up('KeyV');
  await expect(page.locator('#chat-mic')).toBeEnabled();await page.locator('#chat-input').fill('Hello');await expect(page.locator('#chat-input')).toHaveValue('Hello');
});
