import {test,expect} from '@playwright/test';

test('waystone question keeps its answer and ignores an unsolicited errand',async({page})=>{
  let decisions=0;
  await page.route('**/api/npc/status',r=>r.fulfill({json:{configured:true,model:'test',remaining:5}}));
  await page.route('**/api/npc/thought/status',r=>r.fulfill({json:{configured:true}}));
  await page.route('**/api/npc/decision',r=>{decisions++;return r.fulfill({json:{action:'INSPECT_WAYSTONE',reply:'STONE'}});});
  await page.route('**/api/npc/thought',r=>r.fulfill({json:{speech:'The waystone marks where this courtyard began.',plan:['INSPECT_WAYSTONE']}}));
  await page.goto('/');await expect(page.locator('#npc-llm')).toBeChecked();
  await page.getByRole('button',{name:'Enter playground'}).click();
  await page.keyboard.down('KeyW');await expect(page.locator('#prompt')).toContainText('caretaker');await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyE');
  await page.getByLabel('Ask the caretaker to do something').fill('What is the waystone?');
  await page.getByRole('button',{name:'Ask caretaker',exact:true}).click();
  await expect(page.locator('#npc-subtitle')).toHaveText('The waystone marks where this courtyard began.');
  await expect(page.locator('#npc-status')).toHaveAttribute('data-action','WAIT');
  await page.waitForTimeout(4500);
  await expect(page.locator('#npc-subtitle')).toHaveText('The waystone marks where this courtyard began.');
  await expect(page.locator('#npc-status')).toHaveAttribute('data-action','WAIT');
  expect(decisions).toBe(0);
});

test('delayed Gemini reply does not freeze play; thoughtful plan supersedes fast decision',async({page})=>{
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/npc/status',r=>r.fulfill({json:{configured:true,model:'test',remaining:5}}));
  await page.route('**/api/npc/thought/status',r=>r.fulfill({json:{configured:true}}));
  await page.route('**/api/npc/decision',r=>r.fulfill({json:{action:'WAIT',reply:'WAIT',remaining:4}}));
  await page.route('**/api/npc/thought',async r=>{
    await gate;await r.fulfill({json:{speech:'Let us visit the stone together. Then I will light the lantern.',plan:['GUIDE_PLAYER','TEND_LANTERN'],latencyMs:3000}});
  });
  await page.goto('/');
  await expect(page.locator('#npc-llm')).toBeChecked();
  await page.getByRole('button',{name:'Enter playground'}).click();
  await page.keyboard.down('KeyW');await expect(page.locator('#prompt')).toContainText('caretaker');await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyE');
  await page.getByLabel('Ask the caretaker to do something').fill('Show me the stone, then tend the lantern');
  await page.getByRole('button',{name:'Ask caretaker',exact:true}).click();
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#npc-status')).toContainText('thinking');
  await page.keyboard.press('F3');
  const before=await page.locator('#diagnostics').textContent();
  await page.keyboard.down('KeyS');
  await expect.poll(()=>page.locator('#diagnostics').textContent()).not.toBe(before);
  await page.keyboard.up('KeyS');
  release();
  await expect(page.locator('#npc-subtitle')).toContainText('visit the stone');
  await expect(page.locator('#npc-status')).toHaveAttribute('data-action','GUIDE_PLAYER');
});
