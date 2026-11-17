import {test,expect} from './fixtures';
test('voice chunks play before the final response and do not call separate TTS',async({page})=>{
  let separateTts=0;
  await page.route('**/api/npc/status',r=>r.fulfill({json:{configured:false}}));
  await page.route('**/api/npc/thought/status',r=>r.fulfill({json:{configured:true}}));
  await page.route('**/api/npc/tts',r=>{separateTts++;return r.fulfill({status:429,json:{error:'unexpected TTS call'}});});
  await page.addInitScript(()=>{
    const original=window.fetch.bind(window);
    window.fetch=(async(input,init)=>{
      if(String(input)!=='/api/npc/thought')return original(input,init);
      const encoder=new TextEncoder();
      const stream=new ReadableStream({start(controller){
        const send=(type:string,data:unknown)=>controller.enqueue(encoder.encode(JSON.stringify({type,data})+'\n'));
        send('text','A quick spoken');
        send('audio',btoa('\0'.repeat(4800)));
        setTimeout(()=>send('text',' reply.'),500);
        setTimeout(()=>{send('done',{speech:'A quick spoken reply.',plan:[],latencyMs:4000});controller.close();},4000);
      }});
      return new Response(stream,{headers:{'Content-Type':'application/x-ndjson'}});
    }) as typeof fetch;
  });
  await page.goto('/');await expect(page.locator('#npc-llm')).toBeChecked();
  await page.locator('#npc-voice').check();
  await page.getByRole('button',{name:'Enter original playground'}).click();
  await page.keyboard.press('KeyT');await page.locator('#chat-input').fill('Hello');
  await page.getByRole('button',{name:'Send message'}).click();
  await expect(page.locator('#chat-history')).toContainText('A quick spoken reply.');
  await expect(page.locator('#voice-status')).toContainText('Playing voice',{timeout:2000});
  await expect(page.locator('#npc-status')).toContainText('thinking');
  expect(separateTts).toBe(0);
  await expect(page.locator('#chat-history p').filter({hasText:'Caretaker: A quick spoken reply.'})).toHaveCount(1);
  await page.waitForTimeout(4000);
  await expect(page.locator('#chat-history p').filter({hasText:'Caretaker: A quick spoken reply.'})).toHaveCount(1);
});
