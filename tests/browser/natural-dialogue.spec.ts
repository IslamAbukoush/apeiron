import {test,expect} from '@playwright/test';
test('only generated dialogue enters chat; reaching an object does not add an arrival line',async({page})=>{
  await page.route('**/api/npc/status',r=>r.fulfill({json:{configured:false}}));
  await page.route('**/api/npc/thought/status',r=>r.fulfill({json:{configured:true,provider:'groq'}}));
  let calls=0;
  await page.route('**/api/npc/thought',r=>{calls++;return r.fulfill({json:{speech:'Sure, give me a moment to wander over.',plan:[]}});});
  await page.goto('/');await expect(page.locator('#npc-llm')).toBeChecked();await page.getByRole('button',{name:'Enter original playground'}).click();
  await expect(page.locator('#npc-subtitle')).toHaveText('');await expect(page.locator('#chat-history')).not.toContainText('Welcome');
  await page.keyboard.press('KeyT');await page.locator('#chat-input').fill('Go to the bench');await page.getByRole('button',{name:'Send message'}).click();
  await expect(page.locator('#npc-status')).toContainText('Arrived at Wooden bench',{timeout:12000});
  await expect(page.locator('#npc-subtitle')).toHaveText('Sure, give me a moment to wander over.');
  await expect(page.locator('#chat-history p').filter({hasText:/^Caretaker:/})).toHaveCount(1);expect(calls).toBe(1);
  await expect(page.locator('#chat-history')).not.toContainText('Here is');
});
