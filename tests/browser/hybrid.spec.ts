import {test,expect} from '@playwright/test';

test('come here keeps following and stop holds position despite a waystone-biased model',async({page})=>{
  test.setTimeout(45000);
  let decisions=0;
  await page.route('**/api/npc/status',r=>r.fulfill({json:{configured:true,model:'test',remaining:50}}));
  await page.route('**/api/npc/thought/status',r=>r.fulfill({json:{configured:true}}));
  await page.route('**/api/npc/decision',r=>{decisions++;return r.fulfill({json:{action:'GUIDE_PLAYER',reply:'GUIDE'}});});
  await page.route('**/api/npc/thought',r=>r.fulfill({json:{speech:'I will lead you to the waystone.',plan:['GUIDE_PLAYER']}}));
  await page.goto('/');await expect(page.locator('#npc-llm')).toBeChecked();
  await page.getByLabel('Use decision model for the caretaker').check();
  await page.getByRole('button',{name:'Enter original playground'}).click();
  const send=async(text:string)=>{await page.keyboard.press('KeyT');await page.locator('#chat-input').fill(text);await page.getByRole('button',{name:'Send message'}).click();};
  await send('Come here');
  await expect(page.locator('#npc-status')).toHaveAttribute('data-action','FOLLOW_PLAYER');
  await expect(page.locator('#npc-subtitle')).toContainText('I will follow you');
  await page.waitForTimeout(13000);
  await expect(page.locator('#npc-status')).toHaveAttribute('data-action','FOLLOW_PLAYER');
  await expect(page.locator('#npc-subtitle')).not.toContainText('waystone');
  await send('Stop');await expect(page.locator('#npc-status')).toHaveAttribute('data-action','WAIT');
  await expect(page.locator('#npc-subtitle')).toContainText('wait here');
  expect(decisions).toBe(0);
});

test('waystone question keeps its answer and ignores an unsolicited errand',async({page})=>{
  let decisions=0;
  await page.route('**/api/npc/status',r=>r.fulfill({json:{configured:true,model:'test',remaining:5}}));
  await page.route('**/api/npc/thought/status',r=>r.fulfill({json:{configured:true}}));
  await page.route('**/api/npc/decision',r=>{decisions++;return r.fulfill({json:{action:'INSPECT_WAYSTONE',reply:'STONE'}});});
  await page.route('**/api/npc/thought',r=>r.fulfill({json:{speech:'The waystone marks where this courtyard began.',plan:['INSPECT_WAYSTONE']}}));
  await page.goto('/');await expect(page.locator('#npc-llm')).toBeChecked();
  await page.getByRole('button',{name:'Enter original playground'}).click();
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
    await gate;await r.fulfill({json:{speech:'Let us visit the stone together. Then I will light the lantern.',plan:[{action:'GUIDE_TO_OBJECT',targetId:'waystone'},{action:'INTERACT_OBJECT',targetId:'lantern',interaction:'toggle'}],latencyMs:3000}});
  });
  await page.goto('/');
  await expect(page.locator('#npc-llm')).toBeChecked();
  await page.getByRole('button',{name:'Enter original playground'}).click();
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
  await expect(page.locator('#npc-status')).toHaveAttribute('data-action','GUIDE_TO_OBJECT');
});
