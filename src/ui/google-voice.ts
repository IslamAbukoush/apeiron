/** One active voice request/playback; newer replies invalidate old audio. */
type Point={x:number;y:number;z:number};
export class GoogleVoice {
  private controller?:AbortController;
  private audio?:HTMLAudioElement;
  private url?:string;
  private revision=0;
  private context?:AudioContext;
  private panner?:PannerNode;
  private distanceGain?:GainNode;
  private mediaSource?:MediaElementAudioSourceNode;
  private sources=new Set<AudioBufferSourceNode>();
  private listenerPosition:Point={x:0,y:0,z:0};
  private forward:Point={x:0,y:0,z:-1};
  private up:Point={x:0,y:1,z:0};
  private speaker:Point={x:0,y:1.55,z:-2};
  private nextTime=0;
  constructor(private readonly status:HTMLElement){}
  /** Camera and NPC head pose, updated even when no voice is playing. */
  setSpatialPose(position:Point,forward:Point,up:Point,speaker:Point){
    Object.assign(this.listenerPosition,position);Object.assign(this.forward,forward);Object.assign(this.up,up);Object.assign(this.speaker,speaker);
    this.updateSpatialPose();
  }
  private updateSpatialPose(){
    const context=this.context,panner=this.panner;if(!context||!panner)return;
    const listener=context.listener,p=this.listenerPosition,f=this.forward,u=this.up,s=this.speaker,time=context.currentTime;
    if(listener.positionX){
      listener.positionX.setValueAtTime(p.x,time);listener.positionY.setValueAtTime(p.y,time);listener.positionZ.setValueAtTime(p.z,time);
      listener.forwardX.setValueAtTime(f.x,time);listener.forwardY.setValueAtTime(f.y,time);listener.forwardZ.setValueAtTime(f.z,time);
      listener.upX.setValueAtTime(u.x,time);listener.upY.setValueAtTime(u.y,time);listener.upZ.setValueAtTime(u.z,time);
    }else{listener.setPosition(p.x,p.y,p.z);listener.setOrientation(f.x,f.y,f.z,u.x,u.y,u.z);}
    if(panner.positionX){panner.positionX.setValueAtTime(s.x,time);panner.positionY.setValueAtTime(s.y,time);panner.positionZ.setValueAtTime(s.z,time);}else panner.setPosition(s.x,s.y,s.z);
    // Inverse attenuation supplies near-field falloff; gently fade out the far tail.
    const distance=Math.hypot(p.x-s.x,p.y-s.y,p.z-s.z),fade=Math.max(0,Math.min(1,(50-distance)/15));
    this.distanceGain!.gain.setTargetAtTime(fade*fade*(3-2*fade),time,.03);
  }
  private prepareContext(){
    if(!this.context){
      this.context=new AudioContext();this.panner=this.context.createPanner();
      this.panner.panningModel='HRTF';this.panner.distanceModel='inverse';
      this.panner.refDistance=2;this.panner.maxDistance=50;this.panner.rolloffFactor=1.3;
      this.panner.channelCount=1;this.panner.channelCountMode='explicit';
      this.distanceGain=this.context.createGain();this.panner.connect(this.distanceGain);this.distanceGain.connect(this.context.destination);
      this.updateSpatialPose();
    }
    void this.context.resume().catch(()=>{});return this.context;
  }
  stop(){
    this.revision++;this.controller?.abort();this.controller=undefined;this.audio?.pause();
    this.mediaSource?.disconnect();this.mediaSource=undefined;
    this.audio?.removeAttribute('src');this.audio?.load();this.audio=undefined;
    for(const source of this.sources){source.stop();source.disconnect();}this.sources.clear();
    if(this.url)URL.revokeObjectURL(this.url);this.url=undefined;this.nextTime=0;this.status.replaceChildren();
  }
  dispose(){this.stop();this.panner?.disconnect();this.distanceGain?.disconnect();void this.context?.close();this.context=undefined;this.panner=undefined;this.distanceGain=undefined;}
  beginStream(){
    this.stop();this.prepareContext();
    this.status.textContent='Preparing voice…';
  }
  chunk(base64:string){
    const context=this.context;if(!context)return;
    const raw=atob(base64);if(raw.length%2)return;
    const buffer=context.createBuffer(1,raw.length/2,24000),samples=buffer.getChannelData(0);
    for(let i=0;i<samples.length;i++){const n=raw.charCodeAt(i*2)|(raw.charCodeAt(i*2+1)<<8);samples[i]=(n>=32768?n-65536:n)/32768;}
    const source=context.createBufferSource();source.buffer=buffer;source.connect(this.panner!);this.sources.add(source);
    source.onended=()=>{source.disconnect();this.sources.delete(source);};
    this.nextTime=Math.max(this.nextTime,context.currentTime+.06);source.start(this.nextTime);this.nextTime+=buffer.duration;
    if(context.state==='suspended'){
      const button=document.createElement('button');button.textContent='Play voice';button.onclick=()=>{void context.resume();};this.status.replaceChildren(button);
    }else this.status.textContent='Playing voice';
  }
  async speak(text:string,providedAudio?:string){
    this.stop();const context=this.prepareContext(),revision=this.revision;this.controller=new AbortController();this.status.textContent='Generating voice…';
    try{
      const r=providedAudio?await fetch(providedAudio,{signal:this.controller.signal}):await fetch('/api/npc/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text}),signal:this.controller.signal});
      if(!r.ok)throw Error((await r.json()).error||'Voice unavailable');
      const blob=await r.blob();if(revision!==this.revision)return;
      this.url=URL.createObjectURL(blob);this.audio=new Audio(this.url);this.audio.controls=true;
      this.mediaSource=context.createMediaElementSource(this.audio);this.mediaSource.connect(this.panner!);
      this.audio.addEventListener('play',()=>{void context.resume().catch(()=>{});});
      this.status.replaceChildren(this.audio);
      try{await this.audio.play();}catch{if(revision===this.revision)this.status.prepend('Press play to hear the reply. ');}
    }catch(error){if(revision===this.revision)this.status.textContent=error instanceof Error?error.message:'Voice unavailable';}
  }
}
