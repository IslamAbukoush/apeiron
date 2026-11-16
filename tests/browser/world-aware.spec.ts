import {test,expect} from '@playwright/test';

test('bench commands work in the courtyard; switching worlds exposes the cupcake and removes old destinations',async({page})=>{
  await page.route('**/api/npc/status',route=>route.fulfill({json:{configured:false}}));
  await page.route('**/api/npc/thought/status',route=>route.fulfill({json:{configured:false}}));
  await page.goto('/');await page.getByRole('button',{name:'Enter original playground'}).click();await expect(page.locator('#hud')).toBeVisible();
  const send=async(message:string)=>{await page.keyboard.press('KeyT');await page.locator('#chat-input').fill(message);await page.getByRole('button',{name:'Send message'}).click();};
  await send('Go to the bench');await expect(page.locator('#npc-status')).toHaveAttribute('data-target','bench');
  await expect(page.locator('#npc-status')).toContainText('Arrived at Wooden bench',{timeout:12000});
  await send('Sit on the bench');await expect(page.locator('#npc-status')).toContainText('Sitting on Wooden bench',{timeout:5000});
  await page.evaluate(()=>document.exitPointerLock());await page.getByRole('button',{name:'Create another world'}).click();
  await page.getByLabel('Describe your world').fill('A pink candy world');await page.getByRole('button',{name:'Generate world',exact:true}).click();await page.getByRole('button',{name:'Enter world',exact:true}).click();await expect(page.locator('#hud')).toBeVisible();
  await send('Go to the big cup cake');await expect(page.locator('#npc-status')).toHaveAttribute('data-target','landmark');
  await expect(page.locator('#npc-status')).toContainText('Arrived at Giant cupcake',{timeout:12000});
  await page.screenshot({path:'artifacts/world-aware-cupcake.png'});
  await page.evaluate(()=>document.exitPointerLock());await page.getByRole('button',{name:'Create another world'}).click();
  await page.getByLabel('Describe your world').fill('A frozen world');await page.getByRole('button',{name:'Generate world',exact:true}).click();await page.getByRole('button',{name:'Enter world',exact:true}).click();await expect(page.locator('#hud')).toBeVisible();
  await send('Show me the cupcake');await expect(page.locator('#npc-status')).toContainText('cannot find that object');await expect(page.locator('#npc-status')).toHaveAttribute('data-action','WAIT');
  await send('Inspect the frost spire');await expect(page.locator('#npc-status')).toHaveAttribute('data-target','landmark');
  await expect(page.locator('#npc-status')).toContainText('Arrived at Frost spire',{timeout:12000});await expect(page.locator('#npc-subtitle')).toHaveText('');
});

test('the planner gets the current map and can return a generic object action for unfamiliar wording',async({page})=>{
  await page.route('**/api/npc/status',route=>route.fulfill({json:{configured:false}}));
  await page.route('**/api/npc/thought/status',route=>route.fulfill({json:{configured:true}}));
  let payload:any;
  await page.route('**/api/npc/thought',route=>{payload=route.request().postDataJSON();return route.fulfill({json:{speech:'I will go to the giant cupcake.',plan:[{action:'GO_TO_OBJECT',targetId:'landmark'}],provider:'local',worldId:payload.world.id}});});
  await page.goto('/');await page.getByLabel('Describe your world').fill('A candy world');await page.getByRole('button',{name:'Generate world',exact:true}).click();await page.getByRole('button',{name:'Enter world',exact:true}).click();await expect(page.locator('#hud')).toBeVisible();
  await page.keyboard.press('KeyT');await page.locator('#chat-input').fill('Visit the frosting monument');await page.getByRole('button',{name:'Send message'}).click();
  await expect(page.locator('#npc-status')).toHaveAttribute('data-action','GO_TO_OBJECT');
  expect(payload.world.name).toBe('Sugarbloom Valley');expect(payload.world.limit).toBe(29);
  expect(payload.world.objects.find((object:any)=>object.id==='landmark').name).toBe('Giant cupcake');
  await expect(page.locator('#npc-status')).toHaveAttribute('data-target','landmark');
});
