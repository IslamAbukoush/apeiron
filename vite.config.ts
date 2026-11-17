import { defineConfig, loadEnv } from 'vite';
import { createDecisionMiddleware } from './server/decision.ts';
import { createTtsMiddleware } from './server/tts.ts';
import { LocalTts } from './server/local-tts.ts';
import { LocalLlm,LOCAL_MODEL } from './server/local-llm.ts';
import { createLocalThoughtMiddleware } from './server/local-thought.ts';
import {createGroqThoughtMiddleware} from './server/groq-thought.ts';
import {LocalVision} from './server/local-vision.ts';
import {createThoughtRouter} from './server/thought-router.ts';
import {createCloudPool} from './server/cloud-pool.ts';
import { LocalStt } from './server/local-stt.ts';
import { createSttMiddleware } from './server/stt.ts';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd()+'/AI-TEST', ['ANYROUTER_']), ...loadEnv(mode, process.cwd(), ['GEMINI_','GROQ_','ANYROUTER_','DEEPGRAM_','ZAI_','NPC_','PARADEE_']), ...process.env };
  const local=new LocalTts(process.cwd(),env.PARADEE_VOICE||'am_puck');
  const llm=new LocalLlm();
  const recognizer=new LocalStt();
  const stt=createSttMiddleware(recognizer);
  const model=env.NPC_LOCAL_MODEL||LOCAL_MODEL;
  const vision=new LocalVision({model,start:()=>llm.start()});
  const localThought=createLocalThoughtMiddleware({model,start:()=>llm.start(),status:()=>llm.status(model)});
  const hybridThought=createGroqThoughtMiddleware({apiKey:env.GROQ_API_KEY,model:env.GROQ_MODEL,vision});
  const cloud=createCloudPool({geminiKey:env.GEMINI_API_KEY,groqKey:env.GROQ_API_KEY,anyrouterKey:env.ANYROUTER_API_KEY,zaiKey:env.ZAI_API_KEY,geminiModels:env.NPC_GEMINI_MODELS?.split(',').map(s=>s.trim()).filter(Boolean),groqModels:env.NPC_GROQ_MODELS?.split(',').map(s=>s.trim()).filter(Boolean)});
  const thought=createThoughtRouter({default:cloud.middleware,auto:cloud.middleware,local:localThought,hybrid:hybridThought});
  const tts=createTtsMiddleware({local,deepgramKey:env.DEEPGRAM_API_KEY});
  const middleware = createDecisionMiddleware({ apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_DECISION_MODEL, limit: Number(env.GEMINI_DECISION_LIMIT) || undefined });
  // Keep recognition ready for push-to-talk, then warm the much smaller voice
  // model. Local conversation/vision loads on demand instead of competing for RAM.
  function startSpeech(){
    let closed=false;
    void recognizer.start().catch(error=>console.warn(error.message)).then(()=>{
      if(!closed)return local.start().catch(error=>console.warn(error.message));
    });
    return ()=>{closed=true;recognizer.close();local.close();llm.close();};
  }
  return { plugins: [{ name: 'npc-decisions',
    configureServer(server) {
      server.httpServer?.once('close',startSpeech());
      server.middlewares.use(stt);server.middlewares.use(tts);server.middlewares.use(thought);server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.httpServer.once('close',startSpeech());
      server.middlewares.use(stt);server.middlewares.use(tts);server.middlewares.use(thought);server.middlewares.use(middleware);
    },
  }] };
});
