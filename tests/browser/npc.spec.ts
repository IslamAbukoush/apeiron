import { test, expect } from '@playwright/test';
test.beforeEach(async({page})=>{
  await page.route('**/api/npc/thought/status',route=>route.fulfill({json:{configured:false}}));
});

test('player free-text request reaches model and controls following',async ({page}) => {
  const requests: string[]=[];
  await page.route('**/api/npc/status',route => route.fulfill({json:{configured:true,model:'test model',remaining:5}}));
  await page.route('**/api/npc/decision',route => {
    const request=route.request().postDataJSON().request;
    requests.push(request);
    return route.fulfill({json:{action:request?'FOLLOW_PLAYER':'WAIT',reply:request?'FOLLOW':'WAIT',remaining:3,latencyMs:10}});
  });
  await page.goto('/');
  await expect(page.locator('#npc-service')).toContainText('test model');
  await page.getByLabel('Use decision model for the caretaker').check();
  await page.getByRole('button',{name:'Enter original playground'}).click();
  await page.keyboard.down('KeyW');
  await expect(page.locator('#prompt')).toContainText('caretaker');
  await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyE');
  await page.getByLabel('Ask the caretaker to do something').fill('Please follow me');
  await page.getByRole('button',{name:'Ask caretaker',exact:true}).click();
  await expect(page.locator('#npc-subtitle')).toContainText('I will follow you');
  expect(requests).toContain('Please follow me');
  await page.screenshot({path:'artifacts/npc-conversation.png'});
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#npc-status')).toHaveAttribute('data-action','FOLLOW_PLAYER');
  const before=Number(await page.locator('#npc-status').getAttribute('data-z'));
  await page.keyboard.down('KeyS');
  await expect.poll(async () => Number(await page.locator('#npc-status').getAttribute('data-z'))).toBeGreaterThan(before+.5);
  await page.keyboard.up('KeyS');
});

test('model decision moves the caretaker and changes the lantern; pause freezes movement',async ({page}) => {
  const errors: string[]=[];
  page.on('pageerror',e => errors.push(e.message));
  let requests=0;
  await page.route('**/api/npc/status',route => route.fulfill({json:{configured:true,model:'test decision model',remaining:5}}));
  await page.route('**/api/npc/decision',async route => {
    requests++;
    const state=route.request().postDataJSON();
    expect(state.npc.action).toBeDefined();
    expect(state.player.z).toBeGreaterThan(0);
    await route.fulfill({json:{action:'TEND_LANTERN',reply:'LANTERN',latencyMs:10,remaining:4}});
  });
  await page.goto('/');
  await expect(page.locator('#npc-service')).toContainText('test decision model');
  await page.getByLabel('Use decision model for the caretaker').check();
  await page.getByRole('button',{name:'Enter original playground'}).click();
  await expect(page.locator('#npc-status')).toContainText('Model');
  await expect(page.locator('#npc-status')).toHaveAttribute('data-lantern','true',{timeout:15000});
  await expect(page.locator('#npc-status')).toHaveAttribute('data-visited',/lantern/);
  expect(requests).toBe(1);
  await page.screenshot({path:'artifacts/npc-lantern.png'});
  await page.evaluate(() => document.exitPointerLock());
  await expect(page.getByRole('heading',{name:'Paused'})).toBeVisible();
  const position=await page.locator('#npc-status').getAttribute('data-z');
  await page.waitForTimeout(500);
  expect(await page.locator('#npc-status').getAttribute('data-z')).toBe(position);
  expect(errors).toEqual([]);
});

test('quota failure is visible and stops further model requests',async ({page}) => {
  let requests=0;
  await page.route('**/api/npc/status',route => route.fulfill({json:{configured:true,model:'test model',remaining:5}}));
  await page.route('**/api/npc/decision',route => {
    requests++; return route.fulfill({status:429,json:{error:'Trial quota exhausted'}});
  });
  await page.goto('/');
  await expect(page.locator('#npc-service')).toContainText('test model');
  await page.getByLabel('Use decision model for the caretaker').check();
  await page.getByRole('button',{name:'Enter original playground'}).click();
  await expect(page.locator('#npc-status')).toContainText('Local fallback');
  await expect(page.locator('#npc-status')).toContainText('Trial quota exhausted');
  await page.evaluate(() => document.exitPointerLock());
  await expect(page.getByLabel('Use decision model for the caretaker')).not.toBeChecked();
  expect(requests).toBe(1);
});
