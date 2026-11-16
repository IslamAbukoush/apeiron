/** One active voice request/playback; newer replies invalidate old audio. */
export class GoogleVoice {
  private controller?:AbortController;
  private audio?:HTMLAudioElement;
  private url?:string;
  private revision=0;
  constructor(private readonly status:HTMLElement){}
  stop(){this.revision++;this.controller?.abort();this.audio?.pause();if(this.url)URL.revokeObjectURL(this.url);this.url=undefined;}
  async speak(text:string){
    this.stop();const revision=this.revision;this.controller=new AbortController();this.status.textContent='Generating Google voice…';
    try{
      const r=await fetch('/api/npc/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text}),signal:this.controller.signal});
      if(!r.ok)throw Error((await r.json()).error||'Google voice unavailable');
      const blob=await r.blob();if(revision!==this.revision)return;
      this.url=URL.createObjectURL(blob);this.audio=new Audio(this.url);this.audio.controls=true;
      this.status.replaceChildren(this.audio);
      try{await this.audio.play();}catch{this.status.prepend('Press play to hear the reply. ');}
    }catch(error){if(revision===this.revision)this.status.textContent=error instanceof Error?error.message:'Google voice unavailable';}
  }
}
