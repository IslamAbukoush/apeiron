import {test,expect} from './fixtures';
import {pcmToWav} from '../../server/tts';

test('voice settings default to Deepgram, remember voices and allow local-only speech',async({page})=>{
  await page.goto('/');
  await expect(page.locator('#voice-engine')).toHaveValue('deepgram');
  await expect(page.locator('#deepgram-voice')).toHaveValue('aura-2-apollo-en');
  await page.locator('#deepgram-voice').selectOption('aura-2-thalia-en');
  await page.locator('#local-voice').selectOption('bf_isabella');
  await page.locator('#voice-engine').selectOption('paradee');
  await expect(page.locator('#deepgram-voice')).toBeDisabled();
  await page.reload();
  await expect(page.locator('#voice-engine')).toHaveValue('paradee');
  await expect(page.locator('#local-voice')).toHaveValue('bf_isabella');
  await page.locator('#voice-engine').selectOption('deepgram');
  await expect(page.locator('#deepgram-voice')).toBeEnabled();
  await expect(page.locator('#deepgram-voice')).toHaveValue('aura-2-thalia-en');
});

test('voice selection reaches synthesis and fallback is visible during playback',async({page})=>{
  await page.route('**/api/npc/status',r=>r.fulfill({json:{configured:false}}));
  await page.route('**/api/npc/thought/status',r=>r.fulfill({json:{configured:true}}));
  await page.route('**/api/npc/thought',r=>r.fulfill({json:{speech:'Hello there.',plan:[]}}));
  let request:any;
  await page.route('**/api/npc/tts',async route=>{
    request=route.request().postDataJSON();
    await route.fulfill({contentType:'audio/wav',body:pcmToWav(Buffer.alloc(48000)),headers:{'X-NPC-Voice-Provider':'local','X-NPC-Voice-Fallback':'http-429'}});
  });
  await page.goto('/');
  await page.locator('#deepgram-voice').selectOption('aura-2-orion-en');
  await page.locator('#local-voice').selectOption('af_heart');
  await page.getByRole('button',{name:'Enter original playground'}).click();
  await page.keyboard.press('KeyT');await page.locator('#chat-input').fill('Hello');
  await page.getByRole('button',{name:'Send message'}).click();
  await expect(page.locator('#voice-status audio')).toHaveCount(1);
  await expect(page.locator('#voice-status')).toContainText('Local fallback');
  expect(request).toEqual({text:'Hello there.',engine:'deepgram',voice:'aura-2-orion-en',localVoice:'af_heart',stream:true});
});
