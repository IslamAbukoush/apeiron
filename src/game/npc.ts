import { Box3, Group, Vector3 } from 'three';
import { Navigation } from './navigation';
import { ACTIONS, REPLIES, isActionRequest, type Decision, type DecisionState, type NpcAction, type Point, type ViewContext } from './npc-contract';

export const LANDMARKS: Record<string, Point> = {
  waystone: { x:2, z:3 }, lantern: { x:-2,z:3 }, arch: { x:0,z:-10 }, garden: { x:-9,z:-5 },
};
export function localDecision(request: string): Decision {
  if (/jump|hop/i.test(request)) return {action:'JUMP',reply:'ACKNOWLEDGE'};
  if (/follow|come with/i.test(request)) return {action:'FOLLOW_PLAYER',reply:'FOLLOW'};
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
  thoughtStatus = '';
  speechVersion = 0;
  private history: string[] = [];
  private plan: NpcAction[] = [];
  private thoughtController?: AbortController;
  private planned = false;
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

  constructor(readonly mesh: Group, readonly collider: Box3, obstacles: readonly Box3[],
    private readonly lamp: { get(): boolean; toggle(): void },
    private readonly fetcher: typeof fetch = (input,init) => globalThis.fetch(input,init)) {
    this.navigation = new Navigation(obstacles);
    this.syncCollider();
  }
  snapshot(player: Point, request = ''): DecisionState {
    return {npc:{x:this.mesh.position.x,z:this.mesh.position.z,action:this.action,visited:[...this.visited]},
      player:{x:player.x,z:player.z},lanternOn:this.lamp.get(),request};
  }
  setAI(enabled: boolean) {
    this.cancel(); this.aiEnabled = enabled; this.decisionClock = 0;
    this.source = enabled ? 'Model enabled' : 'Local behavior';
  }
  private cancel() { this.epoch++; this.pending?.abort(); this.thoughtController?.abort(); this.busy = false; this.thinking=false; }
  async command(request: string, player: Point, view: ViewContext = {}) {
    this.cancel(); this.plan=[]; this.planned=false;
    this.view=view;
    const actionRequested=isActionRequest(request);
    // Face-to-face questions hold the caretaker in place rather than inventing errands.
    const pointingMove=actionRequested && /\b(there|that (spot|place|point))\b/i.test(request) && /stand|move|walk|go|wait/i.test(request);
    this.apply(pointingMove?{action:'MOVE_TO_TARGET',reply:'ACKNOWLEDGE'}:actionRequested?localDecision(request):{action:'WAIT',reply:'ACKNOWLEDGE'},player);
    if(!this.llmEnabled) this.say(pointingMove?(this.action==='MOVE_TO_TARGET'?'I will stand at the spot you pointed at.':'Point at clear, reachable ground so I can stand there.'):actionRequested?REPLIES[localDecision(request).reply]:
      /who/i.test(request)?REPLIES.IDENTITY:/where|explore/i.test(request)?REPLIES.EXPLORE:
      'Gemini conversation is off. Enable it in the pause menu so I can answer your question.');
    await Promise.allSettled([this.aiEnabled && actionRequested && !pointingMove ? this.decide(player,request) : Promise.resolve(),
      this.llmEnabled ? this.think(player,request) : Promise.resolve()]);
  }
  private async think(player:Point,request:string) {
    this.thinking=true; this.thoughtStatus='Gemini is thinking…';
    const epoch=this.epoch,controller=new AbortController();this.thoughtController=controller;
    const timeout=setTimeout(()=>controller.abort(),28000);
    try {
      const response=await this.fetcher('/api/npc/thought',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...this.snapshot(player,request),history:this.history,view:this.view}),signal:controller.signal});
      const result=await response.json();if(epoch!==this.epoch)return;
      if(!response.ok)throw Error(result.error || 'Gemini unavailable');
      if(typeof result.speech!=='string'||result.speech.length>600||!Array.isArray(result.plan)||result.plan.length>3||result.plan.some((a:string)=>!Object.hasOwn(ACTIONS,a)))throw Error('Invalid Gemini plan');
      this.planned=true;this.plan=isActionRequest(request)?[...result.plan]:[];
      const first=this.plan.shift();if(first)this.apply({action:first,reply:'ACKNOWLEDGE'},player);
      this.say(result.speech);
      this.history.push(`Player: ${request}`,`Caretaker: ${result.speech}`);this.history=this.history.slice(-8);
      this.thoughtStatus=`Gemini · ${result.latencyMs ?? 0} ms`;
    }catch(error){if(epoch===this.epoch){
      this.thoughtStatus=error instanceof Error?error.message:'Gemini unavailable';
      this.say('I could not get a conversation reply from Gemini. Please try again.');
    }}
    finally{clearTimeout(timeout);if(epoch===this.epoch)this.thinking=false;}
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
      if (!this.planned) this.apply(result,player);
      this.source = `Model · ${result.latencyMs ?? 0} ms · ${result.remaining ?? '?'} requests left`;
      if (result.remaining === 0) { this.aiEnabled = false; this.source += ' · local behavior next'; }
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.aiEnabled = false;
      this.source = `Local fallback · ${error instanceof Error ? error.message : 'Model unavailable'}`;
      if (request && !this.planned) this.apply(localDecision(request),player);
    } finally {
      clearTimeout(timer);
      if (epoch === this.epoch) { this.busy = false; this.decisionClock = 12; }
    }
  }
  apply(decision: Decision, player: Point) {
    if(decision.action==='JUMP') { this.hop=.65; return; }
    if(decision.action==='MOVE_TO_TARGET') {
      const target=this.view.target;
      if(!target?.ground || !this.navigation.walkable(target)) {
        this.action='WAIT';this.complete=true;this.route=[];this.activity='Point at clear ground for a destination';return;
      }
      this.action='MOVE_TO_TARGET';this.destination='pointed spot';this.complete=false;
      this.route=this.navigation.path(this.mesh.position,target);
      this.activity=this.route.length?'Walking to the pointed spot':'Cannot reach the pointed spot';
      if(!this.route.length){this.complete=true;this.action='WAIT';}
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
  say(text:string) { this.speech=text;this.speechVersion++; }
  step(dt: number, player: Vector3) {
    if(this.hop>0){this.hop=Math.max(0,this.hop-dt);this.mesh.position.y=Math.sin(this.hop/.65*Math.PI)*.7;}
    this.decisionClock -= dt; this.replan -= dt; this.dwell -= dt;
    if (this.aiEnabled && !this.thinking && !this.plan.length && this.complete && this.action !== 'WAIT' && this.decisionClock <= 0 && !this.busy) void this.decide(player);
    const distance = Math.hypot(player.x-this.mesh.position.x,player.z-this.mesh.position.z);
    if (this.action === 'WAIT') return;
    if (this.complete) {
      if(this.plan.length && this.dwell<=0) {this.apply({action:this.plan.shift()!,reply:'ACKNOWLEDGE'},player);return;}
      if (distance < 3) { this.activity = 'Ready to talk · press E'; return; }
      if (!this.aiEnabled && this.dwell <= 0) {
        const action = !this.visited.has('waystone') ? 'INSPECT_WAYSTONE' : !this.visited.has('lantern') ? 'TEND_LANTERN' : 'PATROL';
        this.apply({action,reply:'ACKNOWLEDGE'},player);
      }
      return;
    }
    if (this.action === 'GUIDE_PLAYER' && distance > 7) { this.activity = 'Waiting for you to catch up'; return; }
    if (this.action === 'FOLLOW_PLAYER' || this.action === 'GREET_PLAYER') {
      if (distance < 2.2) {
        this.route = []; this.activity = this.action === 'FOLLOW_PLAYER' ? 'Following · giving you space' : 'Greeting you';
        if (this.action === 'GREET_PLAYER') { this.complete = true; this.dwell = 4; }
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
    if (Math.hypot(next.x-player.x,next.z-player.z) < .95 && player.y < 1.9) { this.activity = 'Waiting for the path to clear'; return; }
    if (!this.navigation.clear(p,next)) { this.route=[]; this.complete=true; this.dwell=2; return; }
    p.set(next.x,this.hop>0?p.y:0,next.z); this.mesh.rotation.y = Math.atan2(dx,dz);
    this.animation += dt*9;
    for (let i=2;i<this.mesh.children.length;i++) this.mesh.children[i].rotation.x = Math.sin(this.animation+i*Math.PI)*.35;
    this.syncCollider();
    if (length <= .06 || stride === length) this.route.shift();
    if (!this.route.length && !['FOLLOW_PLAYER','GREET_PLAYER'].includes(this.action)) {
      this.complete=true; this.dwell=4;
      if(this.action==='MOVE_TO_TARGET'){this.action='WAIT';this.activity='Standing at the pointed spot';return;}
      this.visited.add(this.destination);
      if (this.action === 'TEND_LANTERN') this.lamp.toggle();
      this.activity = this.action === 'TEND_LANTERN' ? (this.lamp.get()?'The lantern is lit.':'The lantern is out.') : `Inspecting the ${this.destination}`;
    }
  }
  reset() {
    this.cancel(); this.mesh.position.set(0,0,-2); this.mesh.rotation.set(0,0,0);
    this.syncCollider(); this.visited.clear(); this.route=[]; this.complete=true; this.dwell=5;
    this.action='PATROL'; this.activity='Watching the courtyard'; this.decisionClock=0;
    this.plan=[];this.history=[];this.planned=false;this.hop=0;this.thoughtStatus='';
  }
  dispose() { this.cancel(); }
}
