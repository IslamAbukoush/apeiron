import {test,expect} from '@playwright/test';
test('Groq allowance is visible in game and pause menu and refreshes after a reply',async({page})=>{
  let remaining=998;
  await page.route('**/api/npc/status',r=>r.fulfill({json:{configured:false}}));
  await page.route('**/api/npc/thought/status',r=>r.fulfill({json:{provider:'groq',model:'qwen/qwen3.8-27b',configured:true,usage:{updatedAt:Date.now(),requestLimit:1000,requestsRemaining:remaining,tokenLimit:8000,tokensRemaining:6000,requestsReset:'1m26s',tokensReset:'15s',sessionRequests:2,sessionTokens:2000,lastLatencyMs:450}}}));
  await page.route('**/api/npc/thought',r=>{remaining--;return r.fulfill({json:{speech:'The bench is beside the path.',plan:[],provider:'groq',latencyMs:450}});});
  await page.goto('/');await page.getByText('AI model and usage limits',{exact:true}).click();
  await expect(page.locator('#ai-usage-menu')).toContainText('998 / 1,000');
  await page.getByRole('button',{name:'Enter original playground'}).click();
  await expect(page.locator('#ai-usage-hud')).toContainText('Groq');await expect(page.locator('#ai-usage-hud')).toContainText('6,000 / 8,000');
  await page.keyboard.press('KeyT');await page.locator('#chat-input').fill('Where is the bench?');await page.getByRole('button',{name:'Send message'}).click();
  await expect(page.locator('#ai-usage-hud')).toContainText('997 / 1,000');
  await expect(page.locator('#ai-usage-hud')).toContainText('0.45s');
  await page.screenshot({path:'artifacts/groq-usage.png'});
});
