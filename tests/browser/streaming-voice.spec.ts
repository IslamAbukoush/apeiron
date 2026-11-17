import {test,expect} from './fixtures';

test('PCM starts playing before response completion, handles split samples, and cancels cleanly',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Enter original playground'}).click();
  const result=await page.evaluate(async()=>{
    const {GoogleVoice}=await import('/src/ui/google-voice.ts');
    const status=document.createElement('div'),voice=new GoogleVoice(status);
    const original=window.fetch;let complete!:()=>void,aborted=false;
    window.fetch=async(_url,init)=>{
      init?.signal?.addEventListener('abort',()=>{aborted=true;});
      return new Response(new ReadableStream({start(controller){
        controller.enqueue(new Uint8Array(4801));
        complete=()=>{controller.enqueue(new Uint8Array(4799));controller.close();};
      }}),{headers:{'Content-Type':'audio/pcm'}});
    };
    try{
      let finished=false;const speaking=voice.speak('Hello').then(()=>{finished=true;});
      await new Promise(resolve=>setTimeout(resolve,30));
      const early={finished,sources:(voice as any).sources.size,status:status.textContent};
      complete();await speaking;
      const queued=(voice as any).sources.size;voice.stop();
      return {early,queued,remaining:(voice as any).sources.size,aborted};
    }finally{voice.dispose();window.fetch=original;}
  });
  expect(result.early.finished).toBe(false);expect(result.early.sources).toBeGreaterThan(0);expect(result.early.status).toContain('Playing voice');
  expect(result.queued).toBeGreaterThan(0);expect(result.remaining).toBe(0);expect(result.aborted).toBe(true);
});
