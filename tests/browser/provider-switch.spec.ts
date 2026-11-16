import {test,expect} from '@playwright/test';
test('model selector routes local chat, persists on reload and leaves decision model independent',async({page})=>{
  await page.route('**/api/npc/status',r=>r.fulfill({json:{configured:true,model:'decision-test',remaining:100}}));
  await page.route('**/api/npc/thought/status',r=>r.fulfill({json:{configured:true,provider:r.request().headers()['x-npc-provider']==='local'?'local':'groq',model:'test'}}));
  const providers:string[]=[];
  await page.route('**/api/npc/thought',r=>{providers.push(r.request().headers()['x-npc-provider']);return r.fulfill({json:{speech:'Running locally.',plan:[],provider:providers.at(-1)==='local'?'local':'groq'}});});
  await page.goto('/');await expect(page.locator('#npc-llm')).toBeChecked();await page.getByLabel('Use decision model for the caretaker').check();
  await page.getByLabel('Conversation and planning model',{exact:true}).selectOption('local');
  await expect(page.getByLabel('Use decision model for the caretaker')).toBeChecked();
  await expect(page.locator('#ai-usage-menu')).toContainText('no API quota');
  await page.getByLabel('Use decision model for the caretaker').uncheck();
  await page.getByRole('button',{name:'Enter original playground'}).click();await page.keyboard.press('KeyT');await page.locator('#chat-input').fill('Who are you?');await page.getByRole('button',{name:'Send message'}).click();
  await expect(page.locator('#chat-history')).toContainText('Running locally.');expect(providers).toEqual(['local']);
  await page.reload();await expect(page.locator('#npc-provider')).toHaveValue('local');
  await page.getByLabel('Conversation and planning model',{exact:true}).selectOption('hybrid');await expect(page.locator('#ai-usage-menu')).toContainText('Groq');
});
