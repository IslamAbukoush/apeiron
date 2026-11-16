import {test,expect} from '@playwright/test';
test('LLM contextual repeat jumps and a lantern success message cannot precede interaction',async({page})=>{
  await page.route('**/api/npc/status',r=>r.fulfill({json:{configured:false}}));
  await page.route('**/api/npc/thought/status',r=>r.fulfill({json:{configured:true,provider:'groq'}}));
  let repeatContext:any;
  await page.route('**/api/npc/thought',r=>{
    const input=r.request().postDataJSON();
    if(input.request==='Do it again')repeatContext=input.npc.execution;
    return r.fulfill({json:input.request.includes('lantern')?{speech:'I toggled it on.',plan:[{action:'INTERACT_OBJECT',targetId:'lantern',interaction:'toggle',state:'on'}]}:{speech:'Another jump.',plan:['JUMP']}});
  });
  await page.goto('/');await expect(page.locator('#npc-llm')).toBeChecked();await page.getByRole('button',{name:'Enter original playground'}).click();await page.keyboard.press('F3');
  const send=async(text:string)=>{await page.keyboard.press('KeyT');await page.locator('#chat-input').fill(text);await page.getByRole('button',{name:'Send message'}).click();};
  await send('Jump');await page.waitForTimeout(800);await send('Do it again');
  await expect.poll(()=>repeatContext?.step).toBe('JUMP');expect(repeatContext.status).toBe('completed');
  await expect(page.locator('#npc-subtitle')).toHaveText('Another jump.');
  await expect.poll(async()=>Number(await page.locator('#npc-status').getAttribute('data-y')),{timeout:2000}).toBeGreaterThan(.1);
  await send('Toggle the lantern on');await expect(page.locator('#npc-status')).toHaveAttribute('data-action','INTERACT_OBJECT');
  await expect(page.locator('#npc-status')).toHaveAttribute('data-lantern','false');await expect(page.locator('#npc-subtitle')).not.toContainText('I toggled');
  await expect(page.locator('#npc-status')).toHaveAttribute('data-lantern','true',{timeout:12000});
  await expect(page.locator('#npc-subtitle')).toHaveText('');
});
