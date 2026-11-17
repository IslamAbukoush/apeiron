import {test,expect} from './fixtures';
test('defaults enable voice and decision model; debugger explains local and LLM execution',async({page})=>{
  await page.route('**/api/npc/status',r=>r.fulfill({json:{configured:true,model:'decision-test',remaining:100}}));
  await page.route('**/api/npc/thought/status',r=>r.fulfill({json:{configured:true,provider:'gemini'}}));
  await page.route('**/api/npc/thought',r=>r.fulfill({json:{speech:'Another hop.',plan:['JUMP'],provider:'gemini',model:'test-llm'}}));
  await page.route('**/api/npc/decision',r=>r.fulfill({json:{action:'WAIT',reply:'WAIT',latencyMs:20}}));
  await page.goto('/');await expect(page.locator('#npc-ai')).toBeChecked();await expect(page.locator('#npc-voice')).toBeChecked();await expect(page.locator('#npc-llm')).toBeChecked();
  await page.locator('#npc-voice').uncheck();await page.getByText('Settings',{exact:true}).click();await page.getByLabel('Show NPC activity debugger').check();
  await page.getByRole('button',{name:'Enter original playground'}).click();
  await page.keyboard.press('KeyT');await page.locator('#chat-input').fill('Jump');await page.getByRole('button',{name:'Send message'}).click();
  await expect(page.locator('#npc-debug-output')).toContainText('[Local controller]');await expect(page.locator('#npc-debug-output')).toContainText('[LLM]');await expect(page.locator('#npc-debug-output')).toContainText('completed: "JUMP"');
  await page.keyboard.press('KeyT');await page.locator('#chat-input').fill('Do it again');await page.getByRole('button',{name:'Send message'}).click();await expect(page.locator('#npc-debug-output')).toContainText('test-llm');
  await page.evaluate(()=>document.exitPointerLock());await page.screenshot({path:'artifacts/npc-settings-debug.png'});
});
