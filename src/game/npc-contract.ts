import {OBJECT_ACTIONS,type ObjectStep,type WorldSnapshot} from './world-contract.ts';
export const ACTIONS = {
  PATROL: 'Walk to another courtyard landmark.',
  INSPECT_WAYSTONE: 'Walk to the waystone, read it, and remember the inscription.',
  TEND_LANTERN: 'Walk to the lantern and switch it on or off.',
  FOLLOW_PLAYER: 'Follow the player while leaving personal space.',
  GUIDE_PLAYER: 'Lead the player to the waystone; wait if they fall behind.',
  GREET_PLAYER: 'Approach the player and greet them.',
  WAIT: 'Stand still and wait for the player.',
  JUMP: 'Hop once in place, then continue the current task.',
  MOVE_TO_TARGET: 'Walk to the supplied crosshair ground target and stay there. Requires a valid ground target.',
  GO_TO_OBJECT:'Walk to a registered object using its targetId.',
  GUIDE_TO_OBJECT:'Lead the player to targetId, waiting if they fall behind.',
  INSPECT_OBJECT:'Approach targetId and describe it after arriving.',
  INTERACT_OBJECT:'Approach targetId, then perform its supported interaction.',
} as const;
export type NpcAction = keyof typeof ACTIONS;
export function isAutonomyRequest(request:string):boolean {
  return /^(?:(?:please|can you)\s+)?(?:patrol|explore|decide what to do|choose (?:what to do|an activity)|do (?:whatever|what) you (?:want|think|like))\b/i.test(request.trim());
}
/** These explicit player instructions stay in force until replaced by the player. */
export function playerDirective(request:string):'FOLLOW_PLAYER'|'WAIT'|undefined {
  if(!isActionRequest(request))return;
  const text=request.toLowerCase();
  if(/\b(and|then|after|before|until)\b/.test(text))return;
  if(/\b(stop|wait|stay)\b/.test(text))return 'WAIT';
  if(/\bfollow\b|\bcome\s+(here|over|to me|with me|closer)\b/.test(text))return 'FOLLOW_PLAYER';
}
export type NpcStep=NpcAction|ObjectStep;
export type ActionReceipt={step:NpcStep;status:'running'|'completed'|'blocked'|'cancelled';detail:string};
/** Let the LLM interpret contextual/indirect requests; clear questions stay dialogue-only. */
export function canPlanActions(request:string):boolean {
  const text=request.trim().replace(/^(?:(?:please|now)\s+|(?:can|could|would|will) you\s+)*/i,'');
  return !/^(what|where|who|why|how|when|which|tell me|explain|describe|do you|are you|is|does)\b/i.test(text);
}
export const LEGACY_ACTIONS=Object.keys(ACTIONS).filter(action=>!OBJECT_ACTIONS.includes(action as ObjectStep['action']));
export function planStepSchema(ids?:string[]){
  const legacy={type:'string',enum:LEGACY_ACTIONS};
  if(!ids?.length)return legacy;
  return {oneOf:[legacy,{type:'object',properties:{action:{type:'string',enum:OBJECT_ACTIONS.slice(0,3)},targetId:{type:'string',enum:ids}},required:['action','targetId'],additionalProperties:false},
    {type:'object',properties:{action:{type:'string',enum:['INTERACT_OBJECT']},targetId:{type:'string',enum:ids},interaction:{type:'string',enum:['read','toggle','sit']},state:{type:'string',enum:['on','off']}},required:['action','targetId','interaction'],additionalProperties:false}]};
}
export function parsePlan(value:unknown):NpcStep[]{
  if(!Array.isArray(value)||value.length>3)throw Error('Invalid plan');
  return value.map(step=>{
    if(typeof step==='string'&&Object.hasOwn(ACTIONS,step)&&!OBJECT_ACTIONS.includes(step as ObjectStep['action']))return step as NpcAction;
    if(!step||typeof step!=='object'||!OBJECT_ACTIONS.includes(step.action)||typeof step.targetId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(step.targetId)||step.interaction!==undefined&&!['read','toggle','sit'].includes(step.interaction)||step.action==='INTERACT_OBJECT'&&!step.interaction)throw Error('Invalid object action');
    if(step.state!==undefined&&!['on','off'].includes(step.state))throw Error('Invalid interaction state');
    if(step.action!=='INTERACT_OBJECT'&&(step.interaction!==undefined||step.state!==undefined)||step.state!==undefined&&step.interaction!=='toggle')throw Error('Interaction fields require the matching interaction action');
    return {action:step.action,targetId:step.targetId,...(step.interaction?{interaction:step.interaction}:{}),...(step.state?{state:step.state}:{})} as ObjectStep;
  });
}
/** Only explicit requests may change tasks; mentioning an object is not an order. */
export function isActionRequest(request: string): boolean {
  if(isAutonomyRequest(request))return true;
  const text=request.trim().replace(/[.!]+$/,'');
  if (/^(what|where|who|why|how|when|which|tell me|explain|describe|do you|are you|is |does )\b/i.test(text)) return false;
  return /^(?:(?:please|now|then)\s+|(?:can|could|would|will) you\s+|i (?:want|need) you to\s+)*(?:stand|move|follow|come|wait|stop|stay|show|guide|take|tend|toggle|light|switch|turn|inspect|examine|read|visit|patrol|walk|go|jump|hop|lead|sit)\b/i.test(text);
}
export type ViewContext = { image?: string; target?: Point & { y:number; name:string; ground:boolean;objectId?:string } };
export const REPLIES = {
  WELCOME: 'Welcome back. There is always something to tend in this courtyard.',
  FOLLOW: 'I will follow you. Lead the way.',
  GUIDE: 'Come with me. I will show you the waystone.',
  WAIT: 'Of course. I will wait here.',
  STONE: 'The waystone says: “Every world begins with a place to stand.”',
  LANTERN: 'I will tend the lantern by the path.',
  IDENTITY: 'I am the caretaker. I look after the courtyard and its visitors.',
  EXPLORE: 'You can explore the arch, the platforms, and the waystone beside the path.',
  ACKNOWLEDGE: 'Let me see what needs doing.',
} as const;
export type NpcReply = keyof typeof REPLIES;
export type Point = { x: number; z: number };
export type DecisionState = {
  npc: Point & { action: NpcAction; visited: string[];execution?:ActionReceipt };
  player: Point;
  lanternOn: boolean;
  request: string;
  world?:WorldSnapshot;
};
export type Decision = { action: NpcAction; reply: NpcReply; latencyMs?: number; remaining?: number };
