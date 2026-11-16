import {createHash} from 'node:crypto';
import {LOCAL_MODEL,LOCAL_URL} from './local-llm.ts';
export {isVisualRequest as needsVisualContext} from '../src/game/visual-intent.ts';

export type Perception={source:'local';model:string;used:boolean;pending?:boolean;description?:string;latencyMs?:number;cached?:boolean;error?:string};
/** Vision supplies observations only. Executable targets still come from the game registry. */
export class LocalVision {
  readonly model:string;
  private cached?:{key:string;description:string;at:number};
  constructor(private readonly options:{model?:string;start?:()=>Promise<void>;fetcher?:typeof fetch}={}){this.model=options.model||LOCAL_MODEL;}
  async describe(image:string,signal?:AbortSignal|null):Promise<Perception>{
    const started=performance.now(),key=createHash('sha256').update(image).digest('hex');
    if(signal?.aborted)throw Error('Cancelled');
    if(this.cached?.key===key&&Date.now()-this.cached.at<10000)return {source:'local',model:this.model,used:true,description:this.cached.description,latencyMs:0,cached:true};
    await this.options.start?.();if(signal?.aborted)throw Error('Cancelled');
    const response=await (this.options.fetcher||fetch)(LOCAL_URL+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.any([AbortSignal.timeout(18000),...(signal?[signal]:[])]),body:JSON.stringify({model:this.model,think:false,stream:false,keep_alive:'10m',messages:[{role:'user',content:'Describe only what is visibly present in this game screenshot, in at most 70 words. Include major objects, colors, relative positions and the object under the red center crosshair if identifiable. State uncertainty. Do not invent names, hidden objects or actions. This is an observation for another assistant, not dialogue.',images:[image.replace(/^data:image\/\w+;base64,/, '')]}],options:{num_ctx:2048,num_batch:128,num_predict:130,temperature:.1}})});
    if(!response.ok)throw Error('Local vision model failed');
    const data=await response.json(),description=data.message?.content?.trim();
    if(typeof description!=='string'||!description||data.done===false)throw Error('Local vision returned no observation');
    this.cached={key,description:description.slice(0,700),at:Date.now()};
    return {source:'local',model:this.model,used:true,description:this.cached.description,latencyMs:Math.round(performance.now()-started),cached:false};
  }
}
