import {test,expect} from './fixtures';

test('manual provider and model are pinned per request and persist through reload and world changes',async({page})=>{
  const models=[{provider:'anyrouter',model:'minimax/minimax-m3.1-flash:free',vision:false,configured:true},{provider:'anyrouter',model:'nvidia/nemotron-3.5-super-vl-120b-a12b:free',vision:true,configured:true},{provider:'gemini',model:'gemini-3.5-flash-lite',vision:true,configured:true}];
  await page.route('**/api/npc/thought/models',r=>r.fulfill({json:{models}}));
  await page.route('**/api/npc/status',r=>r.fulfill({json:{configured:false}}));
  await page.route('**/api/npc/thought/status',r=>{const h=r.request().headers();return r.fulfill({json:{configured:true,mode:h['x-npc-provider']==='manual'?'manual':'auto',provider:h['x-npc-cloud-provider']||'gemini',model:h['x-npc-model']||'gemini-3.5-flash-lite'}});});
  const calls:any[]=[];await page.route('**/api/npc/thought',r=>{calls.push(r.request().headers());return r.fulfill({json:{speech:'Good to see you.',plan:[],provider:'anyrouter'}});});
  await page.goto('/');await page.locator('#npc-provider').selectOption('manual');await expect(page.getByLabel('AI provider',{exact:true})).toBeVisible();
  await page.getByLabel('AI provider',{exact:true}).selectOption('anyrouter');await page.getByLabel('AI model',{exact:true}).selectOption('minimax/minimax-m3.1-flash:free');
  await expect(page.locator('#npc-model-note')).toContainText('Text only');await expect(page.locator('#ai-usage-menu')).toContainText('Manual');
  await page.reload();await expect(page.locator('#npc-provider')).toHaveValue('manual');await expect(page.getByLabel('AI model',{exact:true})).toHaveValue('minimax/minimax-m3.1-flash:free');
  await page.getByRole('button',{name:'Enter original playground'}).click();await page.keyboard.press('KeyT');await page.locator('#chat-input').fill('Hello');await page.getByRole('button',{name:'Send message'}).click();
  await expect(page.locator('#chat-history')).toContainText('Good to see you.');expect(calls[0]['x-npc-provider']).toBe('manual');expect(calls[0]['x-npc-cloud-provider']).toBe('anyrouter');expect(calls[0]['x-npc-model']).toBe('minimax/minimax-m3.1-flash:free');
  await page.evaluate(()=>document.exitPointerLock());await page.getByRole('button',{name:'Create another world'}).click();await page.locator('#world-prompt').fill('An enchanted forest');await page.getByRole('button',{name:'Generate world',exact:true}).click();await page.getByRole('button',{name:'Enter world',exact:true}).click();
  await page.keyboard.press('KeyT');await page.locator('#chat-input').fill('Hello again');await page.getByRole('button',{name:'Send message'}).click();await expect(page.locator('#chat-history')).toContainText('Good to see you.');expect(calls.at(-1)['x-npc-model']).toBe('minimax/minimax-m3.1-flash:free');
});

test('auto cloud selection shows the active model and model cooldowns and routes chat',async({page})=>{
  await page.route('**/api/npc/status',r=>r.fulfill({json:{configured:false}}));
  await page.route('**/api/npc/thought/status',r=>r.fulfill({json:{configured:true,mode:'auto',provider:'gemini',model:'gemini-3.1-flash-lite',usage:{sessionRequests:2},pool:[{model:'gemini-3.1-flash-lite',provider:'gemini',state:'ready',availableAt:0,requests:1,tokens:20},{model:'gemini-3.5-flash-lite',provider:'gemini',state:'cooling',availableAt:Date.now()+60000,reason:'Rate limited',requests:1,tokens:0}]}}));
  let selected='';await page.route('**/api/npc/thought',r=>{selected=r.request().headers()['x-npc-provider'];return r.fulfill({json:{speech:'Glad to see you.',plan:[],provider:'gemini',model:'gemini-3.1-flash-lite'}});});
  await page.goto('/');await expect(page.locator('#npc-provider')).toHaveValue('auto');
  await expect(page.locator('#ai-usage-menu')).toContainText('Rate limited');
  await expect(page.locator('#ai-usage-menu')).toContainText('1 models ready');
  await page.getByRole('button',{name:'Enter original playground'}).click();await page.keyboard.press('KeyT');await page.locator('#chat-input').fill('Hello');await page.getByRole('button',{name:'Send message'}).click();
  await expect(page.locator('#chat-history')).toContainText('Glad to see you.');expect(selected).toBe('auto');
  await page.reload();await expect(page.locator('#npc-provider')).toHaveValue('auto');
});
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
