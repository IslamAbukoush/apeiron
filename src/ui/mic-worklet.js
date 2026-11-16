// A warm device discards every sample outside an explicit push-to-talk hold.
class MicrophoneCapture extends AudioWorkletProcessor {
  constructor(){
    super();this.samples=new Float32Array(512);this.length=0;this.recording=false;this.id=0;
    this.port.onmessage=({data})=>{
      if(data.type==='start'){this.id=data.id;this.length=0;this.recording=true;}
      if(data.type==='stop'&&data.id===this.id){this.flush();this.recording=false;this.port.postMessage({type:'stopped',id:this.id});}
      if(data.type==='cancel'){this.length=0;this.recording=false;}
    };
  }
  flush(){if(this.length){const samples=this.samples.slice(0,this.length);this.port.postMessage({type:'samples',id:this.id,samples},[samples.buffer]);this.length=0;}}
  process(inputs){
    const channel=inputs[0]?.[0];
    if(this.recording&&channel)for(const sample of channel){
      this.samples[this.length++]=sample;
      if(this.length===this.samples.length)this.flush();
    }
    return true;
  }
}
registerProcessor('microphone-capture',MicrophoneCapture);
