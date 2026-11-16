import {microphoneWav} from './audio-pcm';

/** Keep the device ready; the audio thread captures samples only during a hold. */
export class MicrophoneInput {
  private phase:'idle'|'starting'|'recording'|'stopping'|'transcribing'='idle';
  private revision=0;
  private generation=0;
  private preparing?:Promise<void>;
  private flushed?:()=>void;
  private context?:AudioContext;
  private media?:MediaStream;
  private source?:MediaStreamAudioSourceNode;
  private worklet?:AudioWorkletNode;
  private chunks:Float32Array[]=[];
  private samples=0;
  private timer?:ReturnType<typeof setTimeout>;
  private controller?:AbortController;
  private stopWhenReady=false;
  constructor(private readonly button:HTMLButtonElement,private readonly status:HTMLElement,private readonly onTranscript:(text:string)=>void){}
  get recording(){return this.phase==='recording'||this.phase==='starting';}
  private update(){this.button.textContent=this.recording?'Release to send':this.phase==='transcribing'||this.phase==='stopping'?'Transcribing…':'Hold to talk';this.button.disabled=this.phase==='transcribing'||this.phase==='stopping';this.button.setAttribute('aria-pressed',String(this.recording));}
  async prepare(requestPermission=false){
    if(this.worklet&&this.media?.active){void this.context?.resume();return;}
    if(!navigator.mediaDevices?.getUserMedia)throw Error('Microphone input needs localhost or HTTPS and microphone support.');
    if(!requestPermission){
      try{if((await navigator.permissions.query({name:'microphone' as PermissionName})).state!=='granted')return;}catch{return;}
    }
    if(this.preparing)return this.preparing;
    const generation=this.generation,context=new AudioContext();this.context=context;void context.resume();
    const task=(async()=>{
      const media=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:false}});
      if(generation!==this.generation){media.getTracks().forEach(track=>track.stop());return;}
      this.media=media;await context.audioWorklet.addModule(new URL('./mic-worklet.js',import.meta.url));
      if(generation!==this.generation)return;
      this.source=context.createMediaStreamSource(media);this.worklet=new AudioWorkletNode(context,'microphone-capture');
      const mute=context.createGain();mute.gain.value=0;this.source.connect(this.worklet);this.worklet.connect(mute);mute.connect(context.destination);
      this.worklet.port.onmessage=({data})=>{
        if(data.id!==this.revision)return;
        if(data.type==='stopped'){this.flushed?.();return;}
        if(data.type!=='samples'||!['recording','stopping'].includes(this.phase))return;
        const chunk=(data.samples as Float32Array).slice(0,Math.max(0,context.sampleRate*30-this.samples));
        if(chunk.length){this.chunks.push(chunk);this.samples+=chunk.length;}
        if(this.samples>=context.sampleRate*30)void this.finish();
      };
      this.button.dataset.ready='true';
      if(this.phase==='idle')this.status.textContent='Microphone ready. Hold V while exploring, or hold this button.';
    })();
    this.preparing=task;
    try{await task;}catch(error){if(generation===this.generation)this.release();throw error;}
    finally{if(this.preparing===task)this.preparing=undefined;}
  }
  async start(){
    if(this.phase!=='idle')return;
    const revision=++this.revision;this.phase='starting';this.stopWhenReady=false;this.chunks=[];this.samples=0;this.update();
    if(!this.worklet)this.status.textContent='Preparing microphone. Allow access if prompted; speak when Listening appears.';
    try{
      if(!this.worklet)await this.prepare(true);
      if(revision!==this.revision||!this.worklet)return;
      void this.context?.resume();this.worklet.port.postMessage({type:'start',id:revision});
      this.phase='recording';this.update();this.status.textContent='Listening. Release to send. Escape cancels.';
      this.timer=setTimeout(()=>void this.finish(),30000);
      if(this.stopWhenReady)void this.finish();
    }catch(error){
      if(revision!==this.revision)return;
      this.phase='idle';this.update();
      this.status.textContent=error instanceof DOMException&&error.name==='NotAllowedError'?'Microphone access denied. Allow it in browser site settings and try again.':'Could not open the microphone. Check that it is connected and available.';
    }
  }
  async finish(){
    if(this.phase==='starting'){this.stopWhenReady=true;return;}
    if(this.phase!=='recording')return;
    const revision=this.revision,rate=this.context!.sampleRate;clearTimeout(this.timer);this.phase='stopping';this.update();
    await new Promise<void>(resolve=>{const timer=setTimeout(()=>{this.flushed=undefined;resolve();},200);this.flushed=()=>{clearTimeout(timer);this.flushed=undefined;resolve();};this.worklet!.port.postMessage({type:'stop',id:revision});});
    if(revision!==this.revision)return;
    const samples=new Float32Array(this.samples);let offset=0;for(const chunk of this.chunks){samples.set(chunk,offset);offset+=chunk.length;}
    this.chunks=[];this.phase='transcribing';this.update();this.status.textContent='Transcribing locally…';
    try{
      let peak=0;for(const sample of samples)peak=Math.max(peak,Math.abs(sample));
      if(samples.length<rate*.1||peak<.0001){this.status.textContent='No speech detected. Try again.';return;}
      const wav=await microphoneWav(samples,rate);if(revision!==this.revision)return;
      this.controller=new AbortController();const controller=this.controller;
      const timer=setTimeout(()=>controller.abort(),35000);
      let response:Response;
      try{response=await fetch('/api/npc/transcribe',{method:'POST',headers:{'Content-Type':'audio/wav'},body:wav,signal:controller.signal});}finally{clearTimeout(timer);}
      const result=await response.json();if(revision!==this.revision)return;
      if(!response.ok)throw Error(result.error||'Local speech recognition unavailable.');
      const text=typeof result.text==='string'?result.text.trim().slice(0,400):'';
      if(!text){this.status.textContent='No speech detected. Try again.';return;}
      this.phase='idle';this.update();this.status.textContent=`Heard: ${text}`;this.onTranscript(text);
    }catch(error){if(revision===this.revision)this.status.textContent=error instanceof Error?error.message:'Transcription failed. Try again.';}
    finally{if(revision===this.revision){this.phase='idle';this.update();}}
  }
  private release(){
    this.generation++;this.preparing=undefined;this.button.dataset.ready='false';
    this.media?.getTracks().forEach(track=>track.stop());this.media=undefined;
    this.source?.disconnect();this.source=undefined;
    if(this.worklet){this.worklet.port.onmessage=null;this.worklet.disconnect();this.worklet=undefined;}
    void this.context?.close();this.context=undefined;
  }
  cancel(){
    const active=this.phase!=='idle',starting=this.phase==='starting';this.revision++;clearTimeout(this.timer);this.flushed?.();this.controller?.abort();
    this.worklet?.port.postMessage({type:'cancel'});this.chunks=[];this.phase='idle';if(starting)this.release();this.update();if(active)this.status.textContent='Recording cancelled.';
  }
  suspend(){this.cancel();this.release();}
}
