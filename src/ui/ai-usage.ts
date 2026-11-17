export type AiStatus={provider?:string;model?:string;mode?:string;visionModel?:string;perception?:{used?:boolean;pending?:boolean;latencyMs?:number;cached?:boolean;error?:string};configured?:boolean;error?:string;pool?:{provider:string;model:string;state:string;availableAt:number;reason?:string;requests:number;tokens:number}[];usage?:{
  sessionRequests?:number;sessionTokens?:number;updatedAt?:number;requestLimit?:number|null;requestsRemaining?:number|null;tokenLimit?:number|null;tokensRemaining?:number|null;requestsReset?:string|null;tokensReset?:string|null;retryAfter?:string|null;lastLatencyMs?:number;firstTextMs?:number;lastStatus?:number;freeRequestsRemaining?:number|null;tier?:string|null;
}};
export function resetSeconds(value?:string|null):number|undefined{
  if(!value)return;let total=0,matched=false;
  for(const match of value.matchAll(/([\d.]+)(ms|s|m|h|d)/g)){matched=true;total+=Number(match[1])*({ms:.001,s:1,m:60,h:3600,d:86400}[match[2]]||0);}
  return matched?total:Number.isFinite(Number(value))?Number(value):undefined;
}
export function formatAiUsage(status:AiStatus,now=Date.now(),details=false):string{
  const provider=status.provider==='groq'?'Groq':status.provider==='gemini'?'Gemini':status.provider==='anyrouter'?'AnyRouter':status.provider==='local'?'Local LLM':status.provider||'LLM';
  const title=`${provider}${status.model?' · '+status.model:''}`;
  if(!status.configured)return `${title}\n${status.error||'Not configured'}`;
  if(status.mode==='auto'||status.mode==='manual'){
    const pool=status.pool||[],ready=pool.filter(m=>m.state==='ready'||m.state==='cooling'&&m.availableAt<=now),cooling=pool.filter(m=>m.state==='cooling'&&m.availableAt>now);
    const u=status.usage||{},lines=[`${status.mode==='manual'?'Manual':'Automatic'} · ${title}`,`${ready.length} models ready · ${cooling.length} cooling down`,`Session: ${u.sessionRequests||0} attempts · ${u.sessionTokens||0} tokens${u.lastLatencyMs==null?'':` · Reply: ${(u.lastLatencyMs/1000).toFixed(2)}s`}`];
    if(status.provider==='groq'&&u.requestsRemaining!=null)lines.push(`Groq last report: ${u.requestsRemaining} requests/day · ${u.tokensRemaining??'unknown'} tokens/min left`);
    else if(status.provider==='anyrouter')lines.push(`Free routes only${u.tier?' · '+u.tier:''}${u.freeRequestsRemaining==null?' · Remaining allowance not reported':` · Trial: ${u.freeRequestsRemaining} calls left`}`);
    else lines.push('Remaining quota is not reported by the API.');
    if(status.error)lines.push(status.error);
    if(details){lines.push(status.mode==='manual'?'Pinned to your selection; no automatic fallback.':'Quotas may be shared; switching cannot guarantee availability.');for(const m of pool)lines.push(`${m.model}: ${m.state==='unconfigured'?'no key':m.availableAt>now?`${Math.ceil((m.availableAt-now)/1000)}s cooldown · ${m.reason||'unavailable'}`:'ready'} · ${m.requests} calls`);}
    return lines.join('\n');
  }
  if(status.provider!=='groq')return `${title}\n${status.provider==='local'?'Runs locally · no API quota':'Usage limits not reported by this provider'}`;
  const u=status.usage||{},age=Math.max(0,(now-(u.updatedAt||now))/1000),number=(n?:number|null)=>n==null?'unknown':n.toLocaleString();
  const reset=(value?:string|null)=>{const seconds=resetSeconds(value);if(seconds===undefined)return 'unknown';const left=Math.ceil(seconds-age);return left>0?`${Math.floor(left/60)}m ${left%60}s`:'due; awaiting next API report';};
  const lines=[title,`Requests/day: ${number(u.requestsRemaining)} / ${number(u.requestLimit)} left`,`Tokens/min: ${number(u.tokensRemaining)} / ${number(u.tokenLimit)} left`];
  if(status.mode==='hybrid')lines.splice(1,0,`Vision: local ${status.visionModel||'model'}${status.perception?.pending?' · processing screenshot':status.perception?.error?' · unavailable':status.perception?.used?` · ${((status.perception.latencyMs||0)/1000).toFixed(2)}s${status.perception.cached?' (cached)':''}`:' · on visual requests'}`);
  if(u.updatedAt){lines.push(`Request refill: ${reset(u.requestsReset)} · Token refill: ${reset(u.tokensReset)}`,`Session: ${number(u.sessionRequests)} calls · ${number(u.sessionTokens)} tokens${u.lastLatencyMs==null?'':` · Last reply: ${(u.lastLatencyMs/1000).toFixed(2)}s`}`,`Reported ${Math.floor(age)}s ago · Other apps may use this allowance`);}
  else lines.push('Allowance appears after the first model request.');
  if(u.lastStatus===429)lines.push(`Rate limit reached${u.retryAfter?` · Retry: ${reset(u.retryAfter)}`:''}`);
  else if(status.error)lines.push(status.error);
  return lines.join('\n');
}
