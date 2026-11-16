import {test,expect} from '@playwright/test';

test('local voice plays real Paradee audio without delaying the text reply',async({page})=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
  let voiceProvider:string|undefined;
  await page.route('**/api/npc/status',route=>route.fulfill({json:{configured:false}}));
  await page.route('**/api/npc/thought/status',route=>route.fulfill({json:{configured:true,voiceProvider:'local'}}));
  await page.route('**/api/npc/thought',route=>route.fulfill({json:{speech:'Welcome back, traveler.',plan:[],latencyMs:100}}));
  await page.route('**/api/npc/tts',async route=>{
    await gate;
    const response=await route.fetch();voiceProvider=response.headers()['x-npc-voice-provider'];
    await route.fulfill({response});
  });
  await page.goto('/');
  const status=await(await page.request.get('/api/npc/tts/status')).json();
  test.skip(!status.configured,'Run npm run tts:setup to install the local model.');
  await expect(page.locator('#npc-llm')).toBeChecked();await page.locator('#npc-voice').check();
  await page.getByRole('button',{name:'Enter original playground'}).click();
  await page.keyboard.press('KeyT');await page.locator('#chat-input').fill('Hello');
  await page.getByRole('button',{name:'Send message'}).click();
  try{
    await expect(page.locator('#chat-history')).toContainText('Welcome back, traveler.');
    await expect(page.locator('#voice-status')).toContainText('Generating voice');
    await expect(page.locator('#voice-status audio')).toHaveCount(0);
  }finally{release();}
  const audio=page.locator('#voice-status audio');await expect(audio).toHaveCount(1,{timeout:20000});
  await expect.poll(()=>audio.evaluate(node=>(node as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(2);
  expect(voiceProvider).toBe('local');
  expect(await audio.evaluate(node=>(node as HTMLAudioElement).duration)).toBeGreaterThan(1);
  await expect.poll(()=>audio.evaluate(node=>(node as HTMLAudioElement).paused)).toBe(false);
});
