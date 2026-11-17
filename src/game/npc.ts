import {findObjects,resolveObjectRequest,type ObjectStep} from './world-contract';
import {caretakerAvatar} from './npc-avatar';
import {isVisualRequest} from './visual-intent';
import type {WorldRegistry} from './world-registry';
import { Box3, Group, Vector3,Ray } from 'three';
import { Navigation } from './navigation';
import { ACTIONS, REPLIES, isActionRequest, canPlanActions, isAutonomyRequest, playerDirective, type ActionReceipt, type Decision, type DecisionState, parsePlan, type NpcStep, type NpcAction, type Point, type ViewContext } from './npc-contract';

export const LANDMARKS: Record<string, Point> = {
  waystone: { x:2, z:3 }, lantern: { x:-2,z:3 }, arch: { x:0,z:-10 }, garden: { x:-9,z:-5 },
};
export function localDecision(request: string): Decision {
  if(isAutonomyRequest(request))return {action:'PATROL',reply:'ACKNOWLEDGE'};
  if (/jump|hop/i.test(request)) return {action:'JUMP',reply:'ACKNOWLEDGE'};
  if (/follow|come\s+(here|over|to me|with|closer)/i.test(request)) return {action:'FOLLOW_PLAYER',reply:'FOLLOW'};
  if (/wait|stop|stay/i.test(request)) return {action:'WAIT',reply:'WAIT'};
  if (/lantern|light|lamp/i.test(request)) return {action:'TEND_LANTERN',reply:'LANTERN'};
  if (/show|guide|take me/i.test(request)) return {action:'GUIDE_PLAYER',reply:'GUIDE'};
  if (/stone|inscription/i.test(request)) return {action:'INSPECT_WAYSTONE',reply:'STONE'};
  return {action:'GREET_PLAYER',reply:/who/i.test(request)?'IDENTITY':/explore|where/i.test(request)?'EXPLORE':'WELCOME'};
}

export class Caretaker {
  action: NpcAction = 'PATROL';
  aiEnabled = false;
  busy = false;
  thinking = false;
  llmEnabled = false;
  llmProvider:'local'|'hybrid'|'auto'|'manual'='auto';
  cloudProvider='gemini';
  cloudModel='';
  llmHeaders():Record<string,string>{return {'X-NPC-Provider':this.llmProvider,...(this.llmProvider==='manual'?{'X-NPC-Cloud-Provider':this.cloudProvider,'X-NPC-Model':this.cloudModel}:{})};}
  autonomyInterval=12;
  thoughtStatus = '';
  visionStatus = '';
  speechVersion = 0;
  replyAudio?:string;
  voiceEnabled=true;
  replyStreamed=false;
  onAudioChunk?:(pcm:string)=>void;
  onSpeechChunk?:(text:string)=>void;
  onLookReady?:(focus:Vector3)=>ViewContext;
  private lookFocus=new Vector3();
  private lookTarget?:ViewContext['target'];
  private look?:{focus:Vector3;bounds?:{minX:number;maxX:number;minZ:number;maxZ:number};resolve:(ready:boolean)=>void;remaining:number;settle:number};
  private readonly sightObstacles:readonly Box3[];
  private history: string[] = [];
  private plan: NpcStep[] = [];
  private thoughtController?: AbortController;
  private planned = false;
  private playerTask = false;
  execution?:ActionReceipt;
  private immediateJump=false;
  private hop = 0;
  private view: ViewContext = {};
  source = 'Local behavior';
  readonly debugEvents:{time:string;source:string;detail:string}[]=[];
  private trace(source:string,detail:string){
    this.debugEvents.push({time:new Date().toLocaleTimeString(),source,detail:detail.slice(0,800)});
    if(this.debugEvents.length>40)this.debugEvents.shift();
  }
  debugSummary(){return `Authority: ${this.source}\nDecision: ${this.busy?'request pending':this.aiEnabled?'enabled':'off'} | LLM: ${this.thinking?'request pending':this.llmEnabled?'enabled':'off'}\nAction: ${this.action} | Target: ${this.targetId||'none'}\nQueued plan: ${JSON.stringify(this.plan)}\nExecution: ${this.execution?JSON.stringify(this.execution):'none'}\n${this.thoughtStatus}\n\n${this.debugEvents.slice(-16).map(e=>`${e.time} [${e.source}] ${e.detail}`).join('\n')}`;}

  activity = 'Watching the courtyard';
  speech = '';
  private resolutionError?:string;
  private feedbackPending=false;
  private lastRequest='';
  readonly visited = new Set<string>();
  private route: Point[] = [];
  private destination = 'arch';
  private complete = true;
  private dwell = 5;
  private decisionClock = 0;
  private replan = 0;
  private patrolIndex = 0;
  private animation = 0;
  private epoch = 0;
  private pending?: AbortController;
  private readonly navigation: Navigation;
  private activeObject?:ObjectStep;
  private objectIntent?:ObjectStep;
  private objectPending=false;
  private patrolling=false;
  private seated=false;
  private standingSpot?:Vector3;
  private readonly restPose:{position:Vector3;rotation:Vector3}[];
  get targetId(){return this.activeObject?.targetId||this.destination;}

  constructor(readonly mesh: Group, readonly collider: Box3, obstacles: readonly Box3[],
    private readonly lamp: { get(): boolean; toggle(): void },
    private readonly fetcher: typeof fetch = (input,init) => globalThis.fetch(input,init),
    readonly registry?:WorldRegistry) {
    this.navigation = new Navigation(obstacles,registry?.limit);
    this.sightObstacles=obstacles;
    this.restPose=mesh.children.map(child=>({position:child.position.clone(),rotation:new Vector3(child.rotation.x,child.rotation.y,child.rotation.z)}));
    this.syncCollider();
  }
  snapshot(player: Point, request = ''): DecisionState {
    return {npc:{x:this.mesh.position.x,z:this.mesh.position.z,action:this.action,visited:[...this.visited],...(this.execution?{execution:this.execution}:{})},
      player:{x:player.x,z:player.z},lanternOn:this.lamp.get(),request,...(this.registry?{world:this.registry.snapshot()}:{})};
  }
  setAI(enabled: boolean) {
    this.cancel(); this.aiEnabled = enabled; this.decisionClock = 0;
    this.source = enabled ? 'Model enabled' : 'Local behavior';
  }
  setLlmProvider(provider:'local'|'hybrid'|'auto'|'manual'){this.cancel();this.llmProvider=provider;this.thoughtStatus='';this.source=provider==='local'?'Local LLM selected':provider==='auto'?'Auto cloud selected':provider==='manual'?'Manual cloud selected':'Hybrid LLM selected';}
  private cancel() { this.epoch++;if(this.look){this.route=[];this.complete=true;this.action='WAIT';this.activeObject=undefined;}this.endLook(false); this.pending?.abort(); this.thoughtController?.abort(); this.busy = false; this.thinking=false;this.replyStreamed=false; }
  private endLook(ready:boolean){const look=this.look;this.look=undefined;if(look)look.resolve(ready);}
  private canSee(focus:Vector3,bounds?:{minX:number;maxX:number;minZ:number;maxZ:number}){
    const eye=this.mesh.position.clone();eye.y+=1.55;const distance=eye.distanceTo(focus),ray=new Ray(eye,focus.clone().sub(eye).normalize());
    return !this.sightObstacles.some(box=>{
      if(bounds&&box.min.x>=bounds.minX-.1&&box.max.x<=bounds.maxX+.1&&box.min.z>=bounds.minZ-.1&&box.max.z<=bounds.maxZ+.1)return false;
      const hit=ray.intersectBox(box,new Vector3());return !!hit&&eye.distanceTo(hit)<distance-.25;
    });
  }
  private lookAtTarget(player:Point):Promise<boolean>{
    const target=this.view.target,named=this.registry?findObjects(this.lastRequest,this.registry.snapshot().objects,player):[];
    const object=named.length===1&&!/\b(this|that)\b/i.test(this.lastRequest)?named[0]:target?.objectId?this.registry?.get(target.objectId):undefined;
    const focus=object?this.registry!.focus(object.id)!:new Vector3(target?.x??player.x,target?.y??1.3,target?.z??player.z);
    this.lookTarget=object?{...object.position,y:focus.y,name:object.name,ground:false,objectId:object.id}:target;
    // Looking at the caretaker is a face-to-face question, so join the player instead.
    if(!object&&target?.name==='The caretaker')focus.set(player.x,1.55,player.z);
    const observer=this.view.observer,sceneQuestion=!object&&observer&&/\b(see|surroundings|scene|around)\b/i.test(this.lastRequest);
    if(sceneQuestion)focus.set(observer.x+observer.dx*6,Math.max(.3,Math.min(3,observer.y+observer.dy*6)),observer.z+observer.dz*6);
    const anchor=sceneQuestion?{x:observer.x,z:observer.z}:focus;
    const bounds=object?.bounds;
    const promise=new Promise<boolean>(resolve=>{this.look={focus,bounds,resolve,remaining:60,settle:.35};});
    this.thinking=true;this.thoughtStatus='Approaching to look';
    if(bounds)this.applyStep({action:'GO_TO_OBJECT',targetId:object!.id},player);
    else{
      this.stand();this.activeObject=undefined;this.action='MOVE_TO_TARGET';this.complete=false;
      this.record('MOVE_TO_TARGET','running','Approaching a vantage point for the requested view.');
      this.route=this.navigation.approach(this.mesh.position,{minX:anchor.x-.2,maxX:anchor.x+.2,minZ:anchor.z-.2,maxZ:anchor.z+.2});
      if(!this.route.length){this.action='WAIT';this.complete=true;this.record('MOVE_TO_TARGET','blocked','No reachable vantage point for the requested view.');}
    }
    this.activity=this.execution?.status==='blocked'?this.execution.detail:'Walking over to look at the pointed place';
    if(this.execution?.status==='blocked')this.endLook(false);
    return promise;
  }
  async command(request: string, player: Point, view: ViewContext = {}) {
    this.trace('Player',request);
    this.cancel(); this.plan=[]; this.planned=false;this.objectIntent=undefined;this.objectPending=false;this.immediateJump=false;
    this.resolutionError=undefined;this.feedbackPending=false;this.lastRequest=request;
    this.speech='';
    this.view=view;
    this.visionStatus=this.llmEnabled?(view.image?'Screenshot ready to send':'Text only ? no screenshot attached'):'Enable NPC conversation to use vision';
    const actionRequested=isActionRequest(request);
    const directive=playerDirective(request);
    if(directive||actionRequested)this.trace('Local controller',directive||'Resolving requested object/action before model response');
    // A conversation also holds position; background decisions must not interrupt it.
    this.playerTask=!isAutonomyRequest(request);
    const resolution=this.registry&&actionRequested?resolveObjectRequest(request,this.registry.snapshot(),player,view.target):undefined;
    if(resolution?.error){this.apply({action:'WAIT',reply:'WAIT'},player);this.resolutionError=resolution.error;this.record('WAIT','blocked',resolution.error);this.activity=resolution.error;this.feedbackPending=false;}
    this.objectIntent=resolution?.step;
    this.objectPending=!!this.registry&&actionRequested&&/\b(show|guide|lead|take|inspect|examine|visit|read|sit|toggle|ring|water|open|close|tend|light|switch|turn|walk|go|move|stand)\b/i.test(request)&&!this.objectIntent;
    // Face-to-face questions hold the caretaker in place rather than inventing errands.
    const pointingMove=actionRequested && /\b(there|that (spot|place|point))\b/i.test(request) && /stand|move|walk|go|wait/i.test(request);
    const previousExecution=this.execution;
    if(this.resolutionError){/* The LLM explains retrieved failure facts; no action is started. */}
    else if(this.objectIntent)this.applyStep(this.objectIntent,player);
    else this.apply(directive?{action:directive,reply:directive==='WAIT'?'WAIT':'FOLLOW'}:pointingMove?{action:'MOVE_TO_TARGET',reply:'ACKNOWLEDGE'}:actionRequested&&!this.objectPending?localDecision(request):{action:'WAIT',reply:'ACKNOWLEDGE'},player);
    if(!actionRequested&&previousExecution)this.execution=previousExecution.status==='running'?{...previousExecution,status:'cancelled',detail:'Interrupted by a new player turn.'}:previousExecution;
    this.immediateJump=actionRequested&&localDecision(request).action==='JUMP';
    if(!this.llmEnabled)this.thoughtStatus='Conversation is off; actions can still run.';
    if(this.llmEnabled&&view.image&&isVisualRequest(request)&&!actionRequested){
      const epoch=this.epoch,ready=await this.lookAtTarget(player);if(epoch!==this.epoch)return;
      this.thinking=false;this.feedbackPending=false;
      if(ready&&this.onLookReady){try{this.view={...this.onLookReady(this.lookFocus),target:this.lookTarget,perspective:'npc'};}catch{this.view={target:view.target};this.record('MOVE_TO_TARGET','blocked','NPC camera capture failed.');this.feedbackPending=false;}}
      else if(!ready)this.view={target:view.target};
    }
    await Promise.allSettled([this.aiEnabled && actionRequested && !this.resolutionError && !this.immediateJump && !directive && !pointingMove && !this.objectIntent && !this.objectPending ? this.decide(player,request) : Promise.resolve(),
      this.llmEnabled ? this.think(player,request) : Promise.resolve()]);
  }
  private async think(player:Point,request:string,deliberate=false,actionResult=false) {
    this.thinking=true; this.thoughtStatus='LLM is thinking…';
    const epoch=this.epoch,controller=new AbortController();this.thoughtController=controller;
    const timeout=setTimeout(()=>controller.abort(),45000);
    try {
      this.trace('LLM',`Request via ${this.llmProvider}${this.llmProvider==='manual'?' / '+this.cloudProvider+' / '+this.cloudModel:''}${actionResult?' (action feedback)':''}`);
      const response=await this.fetcher('/api/npc/thought',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson',...this.llmHeaders()},
        body:JSON.stringify({...this.snapshot(player,request),history:deliberate?[]:this.history,view:deliberate||actionResult?{}:this.view,voice:this.voiceEnabled,deliberate,...(actionResult?{event:'action_result'}:{})}),signal:controller.signal});
      if(epoch!==this.epoch)return;
      const vision=response.headers.get('X-NPC-Vision');
      const visionSource=response.headers.get('X-NPC-Vision-Source');
      this.visionStatus=vision==='received'?'Server received screenshot':vision==='none'?'Text only ? server received no image':this.view.image?'Screenshot sent ? server confirmation unavailable':'Text only ? no screenshot attached';
      if(visionSource)this.visionStatus=visionSource==='cloud'?'Cloud model received NPC-eye screenshot':visionSource==='local'?'Local vision processed screenshot · Groq receives text only':visionSource==='local-error'?'Local vision unavailable · screenshot stayed local':'Screenshot not needed for this turn; model receives text only';
      let replyApplied=false;
      const applyReply=(result:any)=>{
        if(epoch!==this.epoch)return;
        if(result.worldId&&result.worldId!==this.registry?.id)throw Error('Reply belongs to a different world');
      if(typeof result.speech!=='string'||result.speech.length>600||!Array.isArray(result.plan)||result.plan.length>3)throw Error('Invalid LLM plan');
      const directive=deliberate||actionResult?undefined:playerDirective(request);
      if(replyApplied){if(!canPlanActions(request)&&result.speech.trim()&&this.speech!==result.speech)this.say(result.speech);return;}
      const validated=parsePlan(result.plan);
      this.trace('LLM',`${result.provider||this.llmProvider} / ${result.model||'model'} returned plan ${JSON.stringify(validated)}${actionResult?' (feedback only)':''}`);
      for(const step of validated)if(typeof step!=='string'){
        const object=this.registry?.get(step.targetId);if(!object||step.action==='INTERACT_OBJECT'&&!object.actions.includes(step.interaction!))throw Error('Unsupported world object or interaction');
      }
      if(actionResult){replyApplied=true;if(result.speech.trim())this.say(result.speech);return;}
      replyApplied=true;this.planned=true;
      this.plan=!actionResult&&!this.resolutionError&&(deliberate||canPlanActions(request))&&!this.objectIntent?[...validated]:[];
      if(directive){
        this.plan=[];
        // Small models sometimes reuse an old errand from conversation history.
        // Preserve the direct instruction and keep spoken acknowledgement consistent.
        if(this.action!==directive)this.apply({action:directive,reply:directive==='WAIT'?'WAIT':'FOLLOW'},player);
      }
      let suppressSpeech=false;
      if(this.feedbackPending&&this.objectIntent&&this.execution?.status==='completed')suppressSpeech=true;
      if(directive&&validated.some(step=>step!==directive))suppressSpeech=true;
      if(this.objectPending&&this.plan.some(step=>typeof step==='string'&&['GUIDE_PLAYER','INSPECT_WAYSTONE','TEND_LANTERN'].includes(step))){this.plan=[];suppressSpeech=true;this.thoughtStatus='Planner did not identify the requested object.';}
      const first=this.plan.shift();if(first&&!(first==='JUMP'&&this.immediateJump))this.applyStep(first,player);
      else if(!actionResult&&(deliberate||isAutonomyRequest(request)))this.apply({action:'WAIT',reply:'WAIT'},player);
      if(!actionResult&&(first||this.objectIntent)&&this.execution?.status==='blocked'){this.plan=[];suppressSpeech=true;this.feedbackPending=true;}
      if(!actionResult&&this.execution?.status!=='completed'&&/\b(i (?:have |already )?(?:turned|toggled|switched|lit|sat|arrived)|done|completed)\b/i.test(result.speech)){suppressSpeech=true;this.thoughtStatus='Unconfirmed completion claim withheld.';}
      if(!actionResult&&canPlanActions(request)&&!this.objectIntent&&!validated.length&&/\b(i (?:will|have|already)|i['’]m (?:coming|going)|i['’]ll|done|completed)\b/i.test(result.speech)){suppressSpeech=true;this.thoughtStatus='No executable action was returned.';}
      this.source='LLM plan · overrides decision model';
        if(!suppressSpeech&&result.speech.trim())this.say(result.speech);
        if(typeof result.audio==='string' && result.audio.startsWith('data:audio/wav;base64,') && result.audio.length<6000000)this.replyAudio=result.audio;
      };
      let result:any;
      if(response.headers.get('Content-Type')?.includes('application/x-ndjson')){
        this.replyStreamed=response.headers.get('X-NPC-Audio')!=='none';
        const reader=response.body!.getReader(),decoder=new TextDecoder();let pending='',transcript='';
        while(true){
          const chunk=await reader.read();pending+=decoder.decode(chunk.value,{stream:!chunk.done});
          if(epoch!==this.epoch){await reader.cancel();return;}
          let newline;
          while((newline=pending.indexOf('\n'))>=0){
            const line=pending.slice(0,newline);pending=pending.slice(newline+1);if(!line)continue;
            const event=JSON.parse(line);
            if(event.type==='audio')this.onAudioChunk?.(event.data);
            else if(event.type==='text'){transcript+=event.data;if(!this.planned&&!playerDirective(request)){this.speech=transcript;this.onSpeechChunk?.(transcript);}}
            else if(event.type==='reply'){applyReply(event.data);}
            else if(event.type==='done'){result=event.data;applyReply(result);}
            else if(event.type==='error')throw Error(event.data);
          }
          if(chunk.done)break;
        }
        if(!result)throw Error('Conversation stream ended early');
      }else{
        result=await response.json();if(epoch!==this.epoch)return;
        if(!response.ok)throw Error(result.error || 'LLM unavailable');
        applyReply(result);
      }
      if(!deliberate){if(!actionResult)this.history.push(`Player: ${request}`);if(result.speech.trim()&&this.speech===result.speech)this.history.push(`Caretaker: ${result.speech}`);this.history=this.history.slice(-8);}
      this.thoughtStatus=`${result.provider==='local'?'Local LLM':'LLM'} · ${result.latencyMs ?? 0} ms`;
    }catch(error){if(epoch===this.epoch){
      this.thoughtStatus=error instanceof Error?error.message:'LLM unavailable';this.trace('LLM error',this.thoughtStatus);
    }}
    finally{clearTimeout(timeout);if(epoch===this.epoch){this.thinking=false;this.decisionClock=this.autonomyInterval;}}
  }
  private async decide(player: Point, request = '') {
    if (this.busy) return;
    this.busy = true; this.pending = new AbortController();
    const epoch = this.epoch;
    const controller = this.pending;
    const timer = setTimeout(() => controller.abort(),15000);
    this.trace('Decision model','Request sent');
    this.source = 'Asking decision model…';
    try {
      const response = await this.fetcher('/api/npc/decision',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(this.snapshot(player,request)),signal:this.pending.signal});
      const result = await response.json();
      if (epoch !== this.epoch) return;
      if (!response.ok) throw new Error(result.error || 'Decision request failed');
      if (!Object.hasOwn(ACTIONS,result.action) || !Object.hasOwn(REPLIES,result.reply)) throw new Error('Invalid model decision');
      this.trace('Decision model',`${result.action}; ${this.planned||playerDirective(request)?'ignored: higher-priority plan or player command':'accepted'}; ${result.latencyMs??0} ms`);
      if (!this.planned && !playerDirective(request)) this.apply(result,player);
      this.source = this.planned?'LLM plan · overrides decision model':`Model · ${result.latencyMs ?? 0} ms · ${result.remaining ?? '?'} requests left`;
      if (result.remaining === 0) { this.aiEnabled = false; this.source += ' · local behavior next'; }
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.trace('Decision error',error instanceof Error?error.message:'Unavailable');
      this.aiEnabled = false;
      this.source = this.planned?'LLM plan · overrides decision model':`Local fallback · ${error instanceof Error ? error.message : 'Model unavailable'}`;
      if (request && !this.planned) this.apply(localDecision(request),player);
    } finally {
      clearTimeout(timer);
      if (epoch === this.epoch) { this.busy = false; this.decisionClock = this.autonomyInterval; }
    }
  }
  private stand(){
    if(!this.seated)return;this.seated=false;this.mesh.scale.y=1;
    if(this.standingSpot)this.mesh.position.copy(this.standingSpot);
    if(!caretakerAvatar(this.mesh))this.mesh.children.forEach((child,i)=>{const pose=this.restPose[i];child.position.copy(pose.position);child.rotation.set(pose.rotation.x,pose.rotation.y,pose.rotation.z);});this.syncCollider();
  }
  private record(step:NpcStep,status:ActionReceipt['status'],detail:string){
    this.trace('Execution',`${status}: ${JSON.stringify(step)} - ${detail}`);
    this.execution={step:typeof step==='string'?step:{...step},status,detail:detail.slice(0,200)};
    if(status==='blocked'){this.activity=detail;this.feedbackPending=this.llmEnabled&&this.playerTask;this.plan=[];}
  }
  private applyStep(step:NpcStep,player:Point){
    if(typeof step==='string'){this.apply({action:step,reply:'ACKNOWLEDGE'},player);return;}
    this.stand();this.activeObject=undefined;this.patrolling=false;
    const object=this.registry?.get(step.targetId);
    if(!object||step.action==='INTERACT_OBJECT'&&(!step.interaction||!object.actions.includes(step.interaction))){this.apply({action:'WAIT',reply:'WAIT'},player);this.record(step,'blocked','Requested object or interaction unavailable.');return;}
    this.route=this.navigation.approach(this.mesh.position,object.bounds);
    if(!this.route.length){this.apply({action:'WAIT',reply:'WAIT'},player);this.record(step,'blocked',`No clear route to ${object.name}.`);return;}
    this.activeObject=step;this.destination=object.id;this.action=step.action;this.complete=false;
    this.record(step,'running',`Approaching ${object.name}; interaction has not happened yet.`);
    this.activity=`${step.action==='GUIDE_TO_OBJECT'?'Guiding you to':'Walking to'} ${object.name}`;
  }
  private finishObject(){
    const step=this.activeObject,object=step&&this.registry?.get(step.targetId);this.activeObject=undefined;
    if(step&&object){
      const p=this.mesh.position,b=object.bounds,distance=Math.hypot(Math.max(b.minX-p.x,0,p.x-b.maxX),Math.max(b.minZ-p.z,0,p.z-b.maxZ));
      if(distance>1.8){this.activeObject=step;this.route=this.navigation.approach(p,b);this.complete=!this.route.length;if(this.complete){this.activeObject=undefined;this.action='WAIT';this.record(step,'blocked','Object moved out of reach.');}return;}
    }
    this.complete=true;this.dwell=.5;this.action=this.patrolling?'PATROL':'WAIT';
    if(!step||!object)return;
    this.visited.add(object.id);this.activity=`Arrived at ${object.name}`;
    if(this.patrolling){this.activity=`Looking around ${object.name}`;return;}
    if(step.action==='INTERACT_OBJECT'&&step.interaction){
      if(['toggle','open'].includes(step.interaction)&&step.state===object.state){this.record(step,'completed',`${object.name}: already ${step.state}; no state change.`);return;}
      try{const result=this.registry!.interact(object.id,step.interaction);
        if(result.seat){this.standingSpot=this.mesh.position.clone();this.mesh.position.copy(result.seat);if(!caretakerAvatar(this.mesh))this.mesh.scale.y=.8;this.seated=true;if(!caretakerAvatar(this.mesh))for(const child of this.mesh.children.slice(2)){child.position.y=.35;child.position.z=.4;child.rotation.x=-Math.PI/2;}this.syncCollider();this.activity=`Sitting on ${object.name}`;}
        else this.activity=`${step.interaction} completed at ${object.name}`;
        this.record(step,'completed',result.message);
      }catch{this.record(step,'blocked','Interaction no longer available.');}
    }else this.record(step,'completed',`${object.description}${object.state?` State: ${object.state}.`:''}`);
    if(this.llmEnabled&&this.playerTask&&(step.action==='INSPECT_OBJECT'||step.interaction==='read'))this.feedbackPending=true;
  }
  apply(decision: Decision, player: Point) {
    if(decision.action==='JUMP') { this.hop=.65;this.dwell=0;this.record('JUMP','running','Jumping once.'); return; }
    if(decision.action!=='WAIT')this.stand();
    if(this.registry){
      const target=decision.action==='GUIDE_PLAYER'||decision.action==='INSPECT_WAYSTONE'?'waystone':decision.action==='TEND_LANTERN'?'lantern':undefined;
      if(target){this.applyStep({action:decision.action==='GUIDE_PLAYER'?'GUIDE_TO_OBJECT':decision.action==='TEND_LANTERN'?'INTERACT_OBJECT':'INSPECT_OBJECT',targetId:target,...(decision.action==='TEND_LANTERN'?{interaction:'toggle' as const}:{})},player);return;}
      if(decision.action==='PATROL'){
        const objects=this.registry.snapshot().objects.filter(object=>object.kind!=='tree').slice(0,12);
        const target=objects[this.patrolIndex++%objects.length];
        if(target){this.applyStep({action:'GO_TO_OBJECT',targetId:target.id},player);this.patrolling=true;if(this.action!=='WAIT')this.action='PATROL';return;}
      }
    }
    this.activeObject=undefined;this.patrolling=false;
    this.record(decision.action,decision.action==='WAIT'?'completed':'running',decision.action==='WAIT'?'Waiting in place.':'Executing '+decision.action);
    if(decision.action==='MOVE_TO_TARGET') {
      const target=this.view.target;
      if(!target?.ground || !this.navigation.walkable(target)) {
        this.action='WAIT';this.complete=true;this.route=[];this.activity='Point at clear ground for a destination';this.record('MOVE_TO_TARGET','blocked',this.activity);return;
      }
      this.action='MOVE_TO_TARGET';this.destination='pointed spot';this.complete=false;
      this.route=this.navigation.path(this.mesh.position,target);
      this.activity=this.route.length?'Walking to the pointed spot':'Cannot reach the pointed spot';
      if(!this.route.length){this.complete=true;this.action='WAIT';this.record('MOVE_TO_TARGET','blocked',this.activity);}
      return;
    }
    this.action = decision.action;
    this.complete = false; this.route = []; this.replan = 0;
    if (this.action === 'WAIT') { this.complete = true; this.activity = 'Waiting for you'; return; }
    if (['FOLLOW_PLAYER','GREET_PLAYER'].includes(this.action)) { this.activity = 'Approaching you'; return; }
    this.destination = this.action === 'TEND_LANTERN' ? 'lantern'
      : this.action === 'INSPECT_WAYSTONE' || this.action === 'GUIDE_PLAYER' ? 'waystone'
      : ['arch','garden','lantern','waystone'][this.patrolIndex++ % 4];
    this.route = this.navigation.path(this.mesh.position,LANDMARKS[this.destination]);
    this.activity = `Walking to the ${this.destination}`;
    if (!this.route.length) { this.complete = true; this.dwell = 3; this.activity = 'Route blocked; waiting'; }
    void player;
  }
  private syncCollider() {
    const p = this.mesh.position;
    this.collider.min.set(p.x-.4,0,p.z-.4); this.collider.max.set(p.x+.4,1.9,p.z+.4);
  }
  say(text:string) { this.replyAudio=undefined;this.speech=text;this.speechVersion++; }
  step(dt: number, player: Vector3) {
    if(this.look){
      this.look.remaining-=dt;
      if(this.look.remaining<=0||this.execution?.status==='blocked'){this.record('MOVE_TO_TARGET','blocked','Could not reach a clear view of the requested place.');this.action='WAIT';this.complete=true;this.route=[];this.endLook(false);}
      else if(this.complete&&this.action==='WAIT'){
        this.mesh.rotation.y=Math.atan2(this.look.focus.x-this.mesh.position.x,this.look.focus.z-this.mesh.position.z);this.look.settle-=dt;
        this.activity='Looking at the pointed place';
        if(this.look.settle<=0){this.lookFocus=this.look.focus.clone();const visible=this.canSee(this.look.focus,this.look.bounds);if(!visible)this.record('MOVE_TO_TARGET','blocked','The view is obstructed from the reachable vantage point.');this.endLook(visible);}
      }
    }
    caretakerAvatar(this.mesh)?.update(dt,this.seated,this.hop>0);
    if(this.feedbackPending&&this.llmEnabled&&!this.thinking){this.feedbackPending=false;void this.think(player,this.lastRequest,false,true);}
    if(this.hop>0){this.hop=Math.max(0,this.hop-dt);this.mesh.position.y=Math.sin(this.hop/.65*Math.PI)*.7;if(this.hop===0&&this.execution?.step==='JUMP')this.record('JUMP','completed','Jumped once.');}
    this.decisionClock -= dt; this.replan -= dt; this.dwell -= dt;
    if (!this.playerTask && !this.thinking && !this.plan.length && this.complete && (!this.llmEnabled||this.dwell<=0) && this.decisionClock <= 0 && !this.busy) {
      this.decisionClock=this.autonomyInterval;this.planned=false;
      if(this.llmEnabled)void this.think(player,'Choose a useful activity in this world. Consider nearby objects, their state and what you have already visited. You may inspect, interact, explore, or wait. Do not repeat the same errand.',true);
      if(this.aiEnabled)void this.decide(player);
    }
    const distance = Math.hypot(player.x-this.mesh.position.x,player.z-this.mesh.position.z);
    if(this.complete&&this.plan.length&&this.hop<=0&&this.dwell<=0)this.applyStep(this.plan.shift()!,player);
    if (this.action === 'WAIT') return;
    if (this.complete) {
      if(this.plan.length && this.hop<=0&&this.dwell<=0) {this.applyStep(this.plan.shift()!,player);return;}
      if (distance < 3) { this.activity = 'Ready to talk · press E'; return; }
      if (!this.playerTask && !this.aiEnabled && !this.llmEnabled && this.dwell <= 0) {
        const action = this.registry?'PATROL':!this.visited.has('waystone') ? 'INSPECT_WAYSTONE' : !this.visited.has('lantern') ? 'TEND_LANTERN' : 'PATROL';
        this.apply({action,reply:'ACKNOWLEDGE'},player);
      }
      return;
    }
    if ((this.action === 'GUIDE_PLAYER'||this.action==='GUIDE_TO_OBJECT') && distance > 7) { this.activity = 'Waiting for you to catch up'; return; }
    if(this.action==='GUIDE_TO_OBJECT'&&this.activeObject)this.activity=`Guiding you to ${this.registry!.get(this.activeObject.targetId)!.name}`;
    if (this.action === 'FOLLOW_PLAYER' || this.action === 'GREET_PLAYER') {
      if (distance < 2.2) {
        this.route = []; this.activity = this.action === 'FOLLOW_PLAYER' ? 'Following · giving you space' : 'Greeting you';
        if (this.action === 'GREET_PLAYER') { this.complete = true; this.dwell = 4;this.record('GREET_PLAYER','completed','Approached the player.'); }
        return;
      }
      if (this.replan <= 0) {
        this.route = this.navigation.path(this.mesh.position,player); this.replan = .8;
        this.activity = this.route.length ? 'Following you' : 'Cannot reach you from here';
      }
    }
    const target = this.route[0];
    if (!target) return;
    const p = this.mesh.position, dx = target.x-p.x, dz = target.z-p.z, length = Math.hypot(dx,dz);
    const stride = Math.min(length,dt*1.6);
    const next = {x:p.x+(length?dx/length*stride:0),z:p.z+(length?dz/length*stride:0)};
    const nextDistance=Math.hypot(next.x-player.x,next.z-player.z);
    if (nextDistance < .95 && nextDistance<=distance && player.y < 1.9) { this.activity = 'Waiting for the path to clear'; return; }
    if (!this.navigation.clear(p,next)) { this.route=[]; this.complete=!['FOLLOW_PLAYER','GREET_PLAYER'].includes(this.action);this.replan=0; this.dwell=2;if(this.activeObject){this.record(this.activeObject,'blocked','Route blocked by an obstacle.');this.activeObject=undefined;this.action='WAIT';}return; }
    p.set(next.x,this.hop>0?p.y:0,next.z); this.mesh.rotation.y = Math.atan2(dx,dz);
    this.animation += dt*9;
    if(!caretakerAvatar(this.mesh))for (let i=2;i<this.mesh.children.length;i++) this.mesh.children[i].rotation.x = Math.sin(this.animation+i*Math.PI)*.35;
    this.syncCollider();
    if (length <= .06 || stride === length) this.route.shift();
    if (!this.route.length && !['FOLLOW_PLAYER','GREET_PLAYER'].includes(this.action)) {
      if(this.activeObject){this.finishObject();return;}
      this.complete=true; this.dwell=4;
      if(this.action==='MOVE_TO_TARGET'){this.record('MOVE_TO_TARGET','completed','Standing at the pointed spot.');this.action='WAIT';this.activity='Standing at the pointed spot';return;}
      this.visited.add(this.destination);
      if (this.action === 'TEND_LANTERN') this.lamp.toggle();
      this.activity = this.action === 'TEND_LANTERN' ? (this.lamp.get()?'The lantern is lit.':'The lantern is out.') : `Inspecting the ${this.destination}`;
      this.record(this.action,'completed',this.activity);
    }
  }
  reset() {
    this.cancel();this.stand();this.activeObject=undefined;this.objectIntent=undefined; this.mesh.position.set(0,0,-2); this.mesh.rotation.set(0,0,0);
    this.syncCollider(); this.visited.clear(); this.route=[]; this.complete=true; this.dwell=5;
    this.action='PATROL'; this.activity='Watching the courtyard'; this.decisionClock=0;
    this.plan=[];this.history=[];this.planned=false;this.playerTask=false;this.hop=0;this.execution=undefined;this.thoughtStatus='';this.speech='';this.feedbackPending=false;this.resolutionError=undefined;this.lastRequest='';
  }
  dispose() { this.cancel(); }
}
