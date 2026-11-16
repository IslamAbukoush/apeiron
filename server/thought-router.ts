import type {IncomingMessage,ServerResponse} from 'node:http';
type Middleware=(req:IncomingMessage,res:ServerResponse,next:()=>void)=>unknown;
/** Selection belongs to each browser/request, never to shared server state. */
export function createThoughtRouter(options:{default:Middleware;local:Middleware;hybrid:Middleware}):Middleware{
  return (req,res,next)=>{
    if(!['/api/npc/thought','/api/npc/thought/status'].includes(req.url||''))return next();
    const provider=req.headers['x-npc-provider'];
    if(provider!==undefined&&provider!=='local'&&provider!=='hybrid'){
      res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Unsupported NPC provider'}));return;
    }
    return (provider==='local'?options.local:provider==='hybrid'?options.hybrid:options.default)(req,res,next);
  };
}
