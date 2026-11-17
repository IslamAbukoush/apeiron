import {test,expect} from './fixtures';

test('real local vision, NPC commands and local speech work together',async({page})=>{
  const status=await(await page.request.get('/api/npc/thought/status')).json();
  test.skip(status.provider!=='local'||!status.configured,'Run npm run llm:setup to install local conversation.');
  await page.route('**/api/npc/status',route=>route.fulfill({json:{configured:false}}));
  let payload:any;
  await page.route('**/api/npc/thought',route=>{payload=route.request().postDataJSON();return route.continue();});
  await page.goto('/');await expect(page.locator('#npc-llm')).toBeChecked();
  await page.locator('#npc-voice').check();await page.getByRole('button',{name:'Enter original playground'}).click();
  await expect(page.locator('#hud')).toBeVisible();
  await page.keyboard.press('KeyT');await page.locator('#chat-input').fill('What do you see here?');
  await page.getByRole('button',{name:'Send message'}).click();
  await expect(page.locator('#npc-status')).toContainText('Local LLM',{timeout:20000});
  await expect(page.locator('#chat-history')).not.toContainText('could not get');
  await expect(page.locator('#chat-history p').filter({hasText:/^Caretaker: /})).toHaveCount(1);
  await expect(page.locator('#chat-vision')).toContainText('Server received screenshot');
  expect(payload.view.image).toMatch(/^data:image\/jpeg;base64,/);
  await expect(page.locator('#voice-status audio')).toHaveCount(1,{timeout:10000});
  await page.keyboard.press('KeyT');await page.locator('#chat-input').fill('Follow me');
  await page.getByRole('button',{name:'Send message'}).click();
  await expect(page.locator('#npc-status')).toHaveAttribute('data-action','FOLLOW_PLAYER',{timeout:15000});
  await page.screenshot({path:'artifacts/local-npc-llm.png'});
});
