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
} as const;
export type NpcAction = keyof typeof ACTIONS;
/** Only explicit requests may change tasks; mentioning an object is not an order. */
export function isActionRequest(request: string): boolean {
  const text=request.trim().replace(/[.!]+$/,'');
  if (/^(what|where|who|why|how|when|which|tell me|explain|describe|do you|are you|is |does )\b/i.test(text)) return false;
  return /^(?:(?:please|now|then)\s+|(?:can|could|would|will) you\s+|i (?:want|need) you to\s+)*(?:stand|move|follow|come|wait|stop|stay|show|guide|take|tend|light|switch|turn|inspect|read|visit|patrol|walk|go|jump|hop|lead)\b/i.test(text);
}
export type ViewContext = { image?: string; target?: Point & { y:number; name:string; ground:boolean } };
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
  npc: Point & { action: NpcAction; visited: string[] };
  player: Point;
  lanternOn: boolean;
  request: string;
};
export type Decision = { action: NpcAction; reply: NpcReply; latencyMs?: number; remaining?: number };
