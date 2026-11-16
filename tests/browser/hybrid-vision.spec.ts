import {test,expect} from '@playwright/test';
test('hybrid mode shows local vision routing, timing and Groq allowance in game',async({page})=>{
  await page.route('**/api/npc/status',r=>r.fulfill({json:{configured:false}}));
  await page.route('**/api/npc/thought/status',r=>r.fulfill({json:{provider:'groq',mode:'hybrid',model:'qwen/qwen3.8-27b',visionModel:'qwen3.5:2b-q4_K_M',configured:true,perception:{used:true,latencyMs:1500},usage:{sessionRequests:1,sessionTokens:800}}}));
  await page.route('**/api/npc/thought',r=>r.fulfill({headers:{'X-NPC-Vision':'received','X-NPC-Vision-Source':'local'},json:{speech:'There are pillars and trees around the path.',plan:[],provider:'groq',latencyMs:1800}}));
  await page.goto('/');await expect(page.locator('#npc-llm')).toBeChecked();await page.getByRole('button',{name:'Enter original playground'}).click();
  await page.keyboard.press('KeyT');await page.locator('#chat-input').fill('What do you see here?');await page.getByRole('button',{name:'Send message'}).click();
  await expect(page.locator('#chat-vision')).toHaveText('Local vision processed screenshot · Groq receives text only',{timeout:15000});
  await expect(page.locator('#ai-usage-hud')).toContainText('Vision: local qwen3.5:2b-q4_K_M · 1.50s');
  await expect(page.locator('#npc-subtitle')).toContainText('pillars and trees');
});
