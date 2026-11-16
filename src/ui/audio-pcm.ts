export function encodePcmWav(samples:Float32Array,rate=16000):ArrayBuffer {
  const buffer=new ArrayBuffer(44+samples.length*2),view=new DataView(buffer);
  const text=(offset:number,value:string)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  text(0,'RIFF');view.setUint32(4,36+samples.length*2,true);text(8,'WAVE');text(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
  text(36,'data');view.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++){const n=Math.max(-1,Math.min(1,samples[i]));view.setInt16(44+i*2,n*(n<0?32768:32767),true);}
  return buffer;
}

export async function microphoneWav(samples:Float32Array,rate:number):Promise<ArrayBuffer>{
  const offline=new OfflineAudioContext(1,Math.floor(samples.length*16000/rate),16000);
  const buffer=offline.createBuffer(1,samples.length,rate);buffer.getChannelData(0).set(samples);
  const source=offline.createBufferSource();source.buffer=buffer;source.connect(offline.destination);source.start();
  return encodePcmWav((await offline.startRendering()).getChannelData(0));
}
