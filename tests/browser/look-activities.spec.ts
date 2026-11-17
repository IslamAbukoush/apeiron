import {test,expect} from './fixtures';
test('a visual question physically approaches the named object before sending an NPC-eye screenshot',async({page})=>{
  let payload:any,calls=0;await page.route('**/api/npc/status',r=>r.fulfill({json:{configured:false}}));await page.route('**/api/npc/thought/status',r=>r.fulfill({json:{configured:true,provider:'groq'}}));
  await page.route('**/api/npc/thought',r=>{calls++;payload=r.request().postDataJSON();return r.fulfill({headers:{'X-NPC-Vision':'received','X-NPC-Vision-Source':'local'},json:{speech:'The bench is a warm brown, with a solid wooden backrest.',plan:[]}});});
  await page.goto('/');await expect(page.locator('#npc-llm')).toBeChecked();await page.getByRole('button',{name:'Enter original playground'}).click();
  await page.keyboard.press('KeyT');await page.locator('#chat-input').fill('What color is the bench?');await page.getByRole('button',{name:'Send message'}).click();
  await expect(page.locator('#npc-status')).toContainText('Walking over to look');expect(calls).toBe(0);
  await expect(page.locator('#npc-subtitle')).toContainText('warm brown',{timeout:15000});
  expect(payload.view.perspective).toBe('npc');expect(payload.view.target.objectId).toBe('bench');expect(payload.view.image).toMatch(/^data:image\/jpeg;base64,/);
  expect(payload.npc.x).toBeGreaterThan(4);await page.screenshot({path:'artifacts/npc-looking-at-bench.png'});
});
test('new activities are executable by the NPC and have persistent visible states',async({page})=>{
  test.setTimeout(60000);const states:any[]=[];
  await page.route('**/api/npc/status',r=>r.fulfill({json:{configured:false}}));await page.route('**/api/npc/thought/status',r=>r.fulfill({json:{configured:true,provider:'groq'}}));
  await page.route('**/api/npc/thought',r=>{states.push(r.request().postDataJSON());return r.fulfill({json:{speech:'',plan:['WAIT']}});});
  await page.goto('/');await expect(page.locator('#npc-llm')).toBeChecked();await page.getByRole('button',{name:'Enter original playground'}).click();
  const send=async(text:string)=>{await page.keyboard.press('KeyT');await page.locator('#chat-view').uncheck();await page.locator('#chat-input').fill(text);await page.getByRole('button',{name:'Send message'}).click();};
  await send('Open the chest');await expect(page.locator('#npc-status')).toContainText('open completed',{timeout:10000});
  await send('Close the chest');await expect.poll(()=>states.at(-1)?.world.objects.find((o:any)=>o.id==='treasure-chest')?.state).toBe('open');await expect(page.locator('#npc-status')).toContainText('open completed',{timeout:5000});
  await send('Ring the bell');await expect(page.locator('#npc-status')).toContainText('ring completed',{timeout:20000});
  await send('Water the flowers');await expect(page.locator('#npc-status')).toContainText('water completed',{timeout:10000});
  await send('How are the flowers?');await expect.poll(()=>states.at(-1)?.world.objects.find((o:any)=>o.id==='flowerbed')?.state).toContain('watered');
  await page.screenshot({path:'artifacts/world-activities.png'});
});
