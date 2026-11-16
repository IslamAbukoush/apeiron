import {resolveObjectRequest,type ObjectStep} from './world-contract';
import type {WorldRegistry} from './world-registry';
import { Box3, Group, Vector3 } from 'three';
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
  autonomyInterval=12;
  thoughtStatus = '';
  visionStatus = '';
  speechVersion = 0;
  replyAudio?:string;
  voiceEnabled=true;
  replyStreamed=false;
  onAudioChunk?:(pcm:string)=>void;
  onSpeechChunk?:(text:string)=>void;
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
  activity = 'Watching the courtyard';
  speech: string = REPLIES.WELCOME;
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
  private cancel() { this.epoch++; this.pending?.abort(); this.thoughtController?.abort(); this.busy = false; this.thinking=false;this.replyStreamed=false; }
  async command(request: string, player: Point, view: ViewContext = {}) {
    this.cancel(); this.plan=[]; this.planned=false;this.objectIntent=undefined;this.objectPending=false;this.immediateJump=false;
    this.view=view;
    this.visionStatus=this.llmEnabled?(view.image?'Screenshot ready to send':'Text only ? no screenshot attached'):'Enable NPC conversation to use vision';
    const actionRequested=isActionRequest(request);
    const directive=playerDirective(request);
    // A conversation also holds position; background decisions must not interrupt it.
    this.playerTask=!isAutonomyRequest(request);
    const resolution=this.registry&&actionRequested?resolveObjectRequest(request,this.registry.snapshot(),player,view.target):undefined;
    if(resolution?.error){this.apply({action:'WAIT',reply:'WAIT'},player);this.say(resolution.error);return;}
    this.objectIntent=resolution?.step;
    this.objectPending=!!this.registry&&actionRequested&&/\b(show|guide|lead|take|inspect|examine|visit|read|sit|toggle|tend|light|switch|turn|walk|go|move|stand)\b/i.test(request)&&!this.objectIntent;
    // Face-to-face questions hold the caretaker in place rather than inventing errands.
    const pointingMove=actionRequested && /\b(there|that (spot|place|point))\b/i.test(request) && /stand|move|walk|go|wait/i.test(request);
    const previousExecution=this.execution;
    if(this.objectIntent)this.applyStep(this.objectIntent,player);
    else this.apply(directive?{action:directive,reply:directive==='WAIT'?'WAIT':'FOLLOW'}:pointingMove?{action:'MOVE_TO_TARGET',reply:'ACKNOWLEDGE'}:actionRequested&&!this.objectPending?localDecision(request):{action:'WAIT',reply:'ACKNOWLEDGE'},player);
    if(!actionRequested&&previousExecution)this.execution=previousExecution.status==='running'?{...previousExecution,status:'cancelled',detail:'Interrupted by a new player turn.'}:previousExecution;
    this.immediateJump=actionRequested&&localDecision(request).action==='JUMP';
    if(directive&&this.llmEnabled)this.say(directive==='WAIT'?REPLIES.WAIT:REPLIES.FOLLOW);
    if(!this.llmEnabled&&this.objectIntent){const object=this.registry!.get(this.objectIntent.targetId)!;this.say(this.action==='WAIT'?this.speech:`${this.objectIntent.action==='GUIDE_TO_OBJECT'?'Come with me. I will show you':this.objectIntent.interaction==='sit'?'I will sit on':'I will approach'} ${object.name}.`);}
    else if(!this.llmEnabled) this.say(this.objectPending&&!pointingMove?'I could not identify that object in this world. Try its name or point at it.':pointingMove?(this.action==='MOVE_TO_TARGET'?'I will stand at the spot you pointed at.':'Point at clear, reachable ground so I can stand there.'):actionRequested?REPLIES[localDecision(request).reply]:
      /who/i.test(request)?REPLIES.IDENTITY:/where|explore/i.test(request)?REPLIES.EXPLORE:
      'NPC conversation is off. Enable it in the pause menu so I can answer your question.');
    await Promise.allSettled([this.aiEnabled && actionRequested && !this.immediateJump && !directive && !pointingMove && !this.objectIntent && !this.objectPending ? this.decide(player,request) : Promise.resolve(),
      this.llmEnabled ? this.think(player,request) : Promise.resolve()]);
  }
  private async think(player:Point,request:string,deliberate=false) {
    this.thinking=true; this.thoughtStatus='LLM is thinking…';
    const epoch=this.epoch,controller=new AbortController();this.thoughtController=controller;
    const timeout=setTimeout(()=>controller.abort(),45000);
    try {
      const response=await this.fetcher('/api/npc/thought',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},
        body:JSON.stringify({...this.snapshot(player,request),history:deliberate?[]:this.history,view:deliberate?{}:this.view,voice:this.voiceEnabled,deliberate}),signal:controller.signal});
      if(epoch!==this.epoch)return;
      const vision=response.headers.get('X-NPC-Vision');
      const visionSource=response.headers.get('X-NPC-Vision-Source');
      this.visionStatus=vision==='received'?'Server received screenshot':vision==='none'?'Text only ? server received no image':this.view.image?'Screenshot sent ? server confirmation unavailable':'Text only ? no screenshot attached';
      if(visionSource)this.visionStatus=visionSource==='local'?'Local vision processed screenshot · Groq receives text only':visionSource==='local-error'?'Local vision unavailable · screenshot stayed local':'Screenshot not needed for this turn · Groq receives text only';
      let replyApplied=false;
      const applyReply=(result:any)=>{
        if(epoch!==this.epoch)return;
        if(result.worldId&&result.worldId!==this.registry?.id)throw Error('Reply belongs to a different world');
      if(typeof result.speech!=='string'||result.speech.length>600||!Array.isArray(result.plan)||result.plan.length>3)throw Error('Invalid LLM plan');
      const directive=deliberate?undefined:playerDirective(request);
      if(directive)result.speech=directive==='WAIT'?REPLIES.WAIT:REPLIES.FOLLOW;
      if(replyApplied){if(!canPlanActions(request)&&this.speech!==result.speech)this.say(result.speech);return;}
      const validated=parsePlan(result.plan);
      for(const step of validated)if(typeof step!=='string'){
        const object=this.registry?.get(step.targetId);if(!object||step.action==='INTERACT_OBJECT'&&!object.actions.includes(step.interaction!))throw Error('Unsupported world object or interaction');
      }
      replyApplied=true;this.planned=true;
      this.plan=(deliberate||canPlanActions(request))&&!this.objectIntent?[...validated]:[];
      if(directive){
        this.plan=[];
        // Small models sometimes reuse an old errand from conversation history.
        // Preserve the direct instruction and keep spoken acknowledgement consistent.
        if(validated.some(step=>step!==directive))result.speech=directive==='WAIT'?REPLIES.WAIT:REPLIES.FOLLOW;
        if(this.action!==directive)this.apply({action:directive,reply:directive==='WAIT'?'WAIT':'FOLLOW'},player);
      }
      if(this.objectPending&&this.plan.some(step=>typeof step==='string'&&['GUIDE_PLAYER','INSPECT_WAYSTONE','TEND_LANTERN'].includes(step))){this.plan=[];result.speech='I could not identify that object. Please point at it or give its name.';}
      if(this.objectIntent&&this.complete&&this.action==='WAIT')result.speech=this.speech;
      const first=this.plan.shift();if(first&&!(first==='JUMP'&&this.immediateJump))this.applyStep(first,player);
      else if(deliberate||isAutonomyRequest(request))this.apply({action:'WAIT',reply:'WAIT'},player);
      if((first||this.objectIntent)&&this.execution?.status==='blocked'){this.plan=[];result.speech=this.execution.detail;}
      else if(this.activeObject&&(this.activeObject.action==='INTERACT_OBJECT'||/\b(i (?:have |already )?(?:turned|toggled|switched|lit|sat|arrived)|done|completed)\b/i.test(result.speech))){
        const step=this.activeObject,object=this.registry!.get(step.targetId)!;
        result.speech=`I will walk to ${object.name}${step.interaction==='toggle'?` and ${step.state?`turn it ${step.state}`:'toggle it'}`:step.interaction==='sit'?' and sit down':step.interaction==='read'?' and read it':''}.`;
      }
      else if(canPlanActions(request)&&!this.objectIntent&&!validated.length&&/\b(i (?:will|have|already)|i['’]m (?:coming|going)|i['’]ll|done|completed)\b/i.test(result.speech))result.speech='I have not started an action. Please clarify what you want me to do.';
      this.source='LLM plan · overrides decision model';
        if(!directive||this.speech!==result.speech)this.say(result.speech);
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
      if(!deliberate){this.history.push(`Player: ${request}`,`Caretaker: ${result.speech}`);this.history=this.history.slice(-8);}
      this.thoughtStatus=`${result.provider==='local'?'Local LLM':'LLM'} · ${result.latencyMs ?? 0} ms`;
    }catch(error){if(epoch===this.epoch){
      this.thoughtStatus=error instanceof Error?error.message:'LLM unavailable';
      if(!playerDirective(request))this.say('I could not get a conversation reply from the model. Please try again.');
    }}
    finally{clearTimeout(timeout);if(epoch===this.epoch){this.thinking=false;this.decisionClock=this.autonomyInterval;}}
  }
  private async decide(player: Point, request = '') {
    if (this.busy) return;
    this.busy = true; this.pending = new AbortController();
    const epoch = this.epoch;
    const controller = this.pending;
    const timer = setTimeout(() => controller.abort(),15000);
    this.source = 'Asking decision model…';
    try {
      const response = await this.fetcher('/api/npc/decision',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(this.snapshot(player,request)),signal:this.pending.signal});
      const result = await response.json();
      if (epoch !== this.epoch) return;
      if (!response.ok) throw new Error(result.error || 'Decision request failed');
      if (!Object.hasOwn(ACTIONS,result.action) || !Object.hasOwn(REPLIES,result.reply)) throw new Error('Invalid model decision');
      if (!this.planned && !playerDirective(request)) this.apply(result,player);
      this.source = this.planned?'LLM plan · overrides decision model':`Model · ${result.latencyMs ?? 0} ms · ${result.remaining ?? '?'} requests left`;
      if (result.remaining === 0) { this.aiEnabled = false; this.source += ' · local behavior next'; }
    } catch (error) {
      if (epoch !== this.epoch) return;
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
    this.mesh.children.forEach((child,i)=>{const pose=this.restPose[i];child.position.copy(pose.position);child.rotation.set(pose.rotation.x,pose.rotation.y,pose.rotation.z);});this.syncCollider();
  }
  private record(step:NpcStep,status:ActionReceipt['status'],detail:string){this.execution={step:typeof step==='string'?step:{...step},status,detail:detail.slice(0,200)};}
  private applyStep(step:NpcStep,player:Point){
    if(typeof step==='string'){this.apply({action:step,reply:'ACKNOWLEDGE'},player);return;}
    this.stand();this.activeObject=undefined;this.patrolling=false;
    const object=this.registry?.get(step.targetId);
    if(!object||step.action==='INTERACT_OBJECT'&&(!step.interaction||!object.actions.includes(step.interaction))){this.apply({action:'WAIT',reply:'WAIT'},player);this.record(step,'blocked','That object or interaction is not available in this world.');this.say(this.execution!.detail);return;}
    this.route=this.navigation.approach(this.mesh.position,object.bounds);
    if(!this.route.length){this.apply({action:'WAIT',reply:'WAIT'},player);this.record(step,'blocked',`I cannot find a clear route to ${object.name}.`);this.say(this.execution!.detail);return;}
    this.activeObject=step;this.destination=object.id;this.action=step.action;this.complete=false;
    this.record(step,'running',`Approaching ${object.name}; interaction has not happened yet.`);
    this.activity=`${step.action==='GUIDE_TO_OBJECT'?'Guiding you to':'Walking to'} ${object.name}`;
  }
  private finishObject(){
    const step=this.activeObject,object=step&&this.registry?.get(step.targetId);this.activeObject=undefined;
    if(step&&object){
      const p=this.mesh.position,b=object.bounds,distance=Math.hypot(Math.max(b.minX-p.x,0,p.x-b.maxX),Math.max(b.minZ-p.z,0,p.z-b.maxZ));
      if(distance>1.8){this.activeObject=step;this.route=this.navigation.approach(p,b);this.complete=!this.route.length;if(this.complete){this.activeObject=undefined;this.action='WAIT';this.record(step,'blocked','That object moved out of reach.');this.say(this.execution!.detail);}return;}
    }
    this.complete=true;this.dwell=.5;this.action=this.patrolling?'PATROL':'WAIT';
    if(!step||!object)return;
    this.visited.add(object.id);this.activity=`Arrived at ${object.name}`;
    if(this.patrolling){this.activity=`Looking around ${object.name}`;return;}
    if(step.action==='INTERACT_OBJECT'&&step.interaction){
      if(step.interaction==='toggle'&&step.state===object.state){this.record(step,'completed',`The ${object.name} is already ${step.state}.`);this.say(this.execution!.detail);return;}
      try{const result=this.registry!.interact(object.id,step.interaction);this.say(result.message);
        if(result.seat){this.standingSpot=this.mesh.position.clone();this.mesh.position.copy(result.seat);this.mesh.scale.y=.8;this.seated=true;for(const child of this.mesh.children.slice(2)){child.position.y=.35;child.position.z=.4;child.rotation.x=-Math.PI/2;}this.syncCollider();this.activity=`Sitting on ${object.name}`;}
        else this.activity=`${step.interaction} completed at ${object.name}`;
        this.record(step,'completed',result.message);
      }catch{this.record(step,'blocked','That interaction is no longer available.');this.say(this.execution!.detail);}
    }else this.say(step.action==='INSPECT_OBJECT'?`${object.description}${object.state?` Current state: ${object.state}.`:''}`:`Here is ${object.name}.`);
    if(step.action!=='INTERACT_OBJECT')this.record(step,'completed',this.speech);
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
    if (!this.navigation.clear(p,next)) { this.route=[]; this.complete=!['FOLLOW_PLAYER','GREET_PLAYER'].includes(this.action);this.replan=0; this.dwell=2;if(this.activeObject){this.record(this.activeObject,'blocked','The route is blocked. Please give me a clear path.');this.activeObject=undefined;this.action='WAIT';this.say(this.execution!.detail);}return; }
    p.set(next.x,this.hop>0?p.y:0,next.z); this.mesh.rotation.y = Math.atan2(dx,dz);
    this.animation += dt*9;
    for (let i=2;i<this.mesh.children.length;i++) this.mesh.children[i].rotation.x = Math.sin(this.animation+i*Math.PI)*.35;
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
    this.plan=[];this.history=[];this.planned=false;this.playerTask=false;this.hop=0;this.execution=undefined;this.thoughtStatus='';
  }
  dispose() { this.cancel(); }
}
