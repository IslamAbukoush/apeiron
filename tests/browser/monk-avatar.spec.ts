import {test,expect} from './fixtures';
test('textured monk loads, animates, interacts and replaces the NPC in every world theme',async({page})=>{
  test.setTimeout(60000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/npc/status',r=>r.fulfill({json:{configured:false}}));await page.route('**/api/npc/thought/status',r=>r.fulfill({json:{configured:false}}));
  await page.goto('/');await page.getByRole('button',{name:'Enter original playground'}).click();
  const status=page.locator('#npc-status');await expect(status).toHaveAttribute('data-avatar','ready');await expect(status).toHaveAttribute('data-animation','idle');
  const send=async(text:string)=>{await page.keyboard.press('KeyT');await page.locator('#chat-input').fill(text);await page.getByRole('button',{name:'Send message'}).click();};
  await send('Jump');await expect(status).toHaveAttribute('data-animation','jump');await expect(status).toHaveAttribute('data-animation','idle');
  await send('Go to the bench');await expect(status).toHaveAttribute('data-animation','walk');await expect(status).toContainText('Arrived at Wooden bench',{timeout:12000});
  await send('Sit on the bench');await expect(status).toHaveAttribute('data-animation','sit');await page.screenshot({path:'artifacts/monk-sitting.png'});
  for(const theme of ['candy','forest','desert','frozen','volcanic','cosmic']){
    await page.evaluate(()=>document.exitPointerLock());await page.getByRole('button',{name:'Create another world'}).click();await page.getByLabel('Describe your world').fill(theme+' world');await page.getByRole('button',{name:'Generate world',exact:true}).click();await page.getByRole('button',{name:'Enter world',exact:true}).click();
    await expect(status).toHaveAttribute('data-avatar','ready');await expect(status).toHaveAttribute('data-animation','idle');
    await page.keyboard.down('KeyW');await expect(page.locator('#prompt')).toContainText('caretaker');await page.keyboard.up('KeyW');await page.keyboard.press('KeyE');await expect(page.getByRole('dialog',{name:'The caretaker'})).toBeVisible();await page.getByRole('button',{name:'Back to exploring'}).click();
    if(theme==='candy')await page.screenshot({path:'artifacts/monk-candy.png'});
  }
  expect(errors).toEqual([]);
});
