/** One active voice request/playback; newer replies invalidate old audio. */
export class GoogleVoice {
  private controller?:AbortController;
  private audio?:HTMLAudioElement;
  private url?:string;
  private revision=0;
  private context?:AudioContext;
  private nextTime=0;
  constructor(private readonly status:HTMLElement){}
  stop(){this.revision++;this.controller?.abort();this.audio?.pause();if(this.url)URL.revokeObjectURL(this.url);this.url=undefined;void this.context?.close();this.context=undefined;}
  beginStream(){
    this.stop();this.context=new AudioContext();this.nextTime=0;void this.context.resume();
    this.status.textContent='Preparing voice…';
  }
  chunk(base64:string){
    const context=this.context;if(!context)return;
    const raw=atob(base64);if(raw.length%2)return;
    const buffer=context.createBuffer(1,raw.length/2,24000),samples=buffer.getChannelData(0);
    for(let i=0;i<samples.length;i++){const n=raw.charCodeAt(i*2)|(raw.charCodeAt(i*2+1)<<8);samples[i]=(n>=32768?n-65536:n)/32768;}
    const source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);
    this.nextTime=Math.max(this.nextTime,context.currentTime+.06);source.start(this.nextTime);this.nextTime+=buffer.duration;
    if(context.state==='suspended'){
      const button=document.createElement('button');button.textContent='Play voice';button.onclick=()=>{void context.resume();};this.status.replaceChildren(button);
    }else this.status.textContent='Playing voice';
  }
  async speak(text:string,providedAudio?:string){
    this.stop();const revision=this.revision;this.controller=new AbortController();this.status.textContent='Generating voice…';
    try{
      const r=providedAudio?await fetch(providedAudio):await fetch('/api/npc/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text}),signal:this.controller.signal});
      if(!r.ok)throw Error((await r.json()).error||'Voice unavailable');
      const blob=await r.blob();if(revision!==this.revision)return;
      this.url=URL.createObjectURL(blob);this.audio=new Audio(this.url);this.audio.controls=true;
      this.status.replaceChildren(this.audio);
      try{await this.audio.play();}catch{this.status.prepend('Press play to hear the reply. ');}
    }catch(error){if(revision===this.revision)this.status.textContent=error instanceof Error?error.message:'Voice unavailable';}
  }
}
