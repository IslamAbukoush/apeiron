import {test,expect} from '@playwright/test';

test('T opens remote chat, sends a marked screenshot and target, and preserves replies',async({page})=>{
  let payload:any;
  await page.route('**/api/npc/status',r=>r.fulfill({json:{configured:false}}));
  await page.route('**/api/npc/thought/status',r=>r.fulfill({json:{configured:true}}));
  await page.route('**/api/npc/thought',r=>{payload=r.request().postDataJSON();return r.fulfill({json:{speech:'That is the caretaker beneath the arch.',plan:[]}});});
  await page.goto('/');await expect(page.locator('#npc-llm')).toBeChecked();
  await page.getByRole('button',{name:'Enter original playground'}).click();
  await page.keyboard.press('KeyT');await expect(page.locator('#chat-input')).toBeFocused();
  await expect(page.locator('#menu')).not.toBeVisible();
  await page.locator('#chat-input').fill('What is this?');await page.getByRole('button',{name:'Send message'}).click();
  await expect(page.locator('#chat-history')).toContainText('That is the caretaker beneath the arch.');
  expect(payload.view.image).toMatch(/^data:image\/jpeg;base64,/);
  expect(payload.view.target).toHaveProperty('x');
  await expect(page.locator('#hud')).toBeVisible();
  await page.keyboard.press('KeyT');await page.locator('#chat-view').uncheck();
  await page.locator('#chat-input').fill('Tell me more');await page.getByRole('button',{name:'Send message'}).click();
  await expect.poll(()=>payload.request).toBe('Tell me more');expect(payload.view.image).toBeUndefined();
  await expect(page.locator('#chat-history')).toContainText('What is this?');
  await page.screenshot({path:'artifacts/npc-chat.png'});
});
