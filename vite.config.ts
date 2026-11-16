import { defineConfig, loadEnv } from 'vite';
import { createDecisionMiddleware } from './server/decision.ts';
import { createThoughtMiddleware } from './server/thought.ts';
import { createTtsMiddleware } from './server/tts.ts';
import { LocalTts } from './server/local-tts.ts';
import { LocalLlm,LOCAL_MODEL } from './server/local-llm.ts';
import { createLocalThoughtMiddleware } from './server/local-thought.ts';
import {createGroqThoughtMiddleware} from './server/groq-thought.ts';
import {LocalVision} from './server/local-vision.ts';
import {createThoughtRouter} from './server/thought-router.ts';
import { LocalStt } from './server/local-stt.ts';
import { createSttMiddleware } from './server/stt.ts';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ['GEMINI_','GROQ_','NPC_','PARADEE_']), ...process.env };
  const local=env.NPC_VOICE_PROVIDER==='gemini'?undefined:new LocalTts(process.cwd(),env.PARADEE_VOICE||'am_puck');
  const llm=new LocalLlm();
  const recognizer=new LocalStt();
  const stt=createSttMiddleware(recognizer);
  const model=env.NPC_LOCAL_MODEL||LOCAL_MODEL;
  const vision=new LocalVision({model,start:()=>llm.start()});
  const localThought=createLocalThoughtMiddleware({model,start:()=>llm.start(),status:()=>llm.status(model)});
  const hybridThought=createGroqThoughtMiddleware({apiKey:env.GROQ_API_KEY,model:env.GROQ_MODEL,vision});
  const defaultThought=env.NPC_LLM_PROVIDER==='hybrid'?hybridThought:env.NPC_LLM_PROVIDER==='groq'?createGroqThoughtMiddleware({apiKey:env.GROQ_API_KEY,model:env.GROQ_MODEL}):env.NPC_LLM_PROVIDER==='gemini'?createThoughtMiddleware({apiKey:env.GEMINI_API_KEY,model:env.GEMINI_MODEL,textModel:env.GEMINI_TEXT_MODEL,limit:Number(env.GEMINI_SESSION_LIMIT)||undefined,localVoice:!!local}):localThought;
  const thought=createThoughtRouter({default:defaultThought,local:localThought,hybrid:hybridThought});
  const tts=createTtsMiddleware({apiKey:env.GEMINI_API_KEY,model:env.GEMINI_TTS_MODEL,local});
  const middleware = createDecisionMiddleware({ apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_DECISION_MODEL, limit: Number(env.GEMINI_DECISION_LIMIT) || undefined });
  return { plugins: [{ name: 'npc-decisions',
    configureServer(server) { if(llm){void llm.warm(model,vision?2048:4096).catch(error=>console.warn(error.message));server.httpServer?.once('close',()=>llm.close());}if(local){void local.start().catch(error=>console.warn(error.message));server.httpServer?.once('close',()=>local.close());}void recognizer.start().catch(error=>console.warn(error.message));server.httpServer?.once('close',()=>recognizer.close());server.middlewares.use(stt);server.middlewares.use(tts); server.middlewares.use(thought); server.middlewares.use(middleware); },
    configurePreviewServer(server) { if(llm){void llm.warm(model,vision?2048:4096).catch(error=>console.warn(error.message));server.httpServer.once('close',()=>llm.close());}if(local){void local.start().catch(error=>console.warn(error.message));server.httpServer.once('close',()=>local.close());}void recognizer.start().catch(error=>console.warn(error.message));server.httpServer?.once('close',()=>recognizer.close());server.middlewares.use(stt);server.middlewares.use(tts); server.middlewares.use(thought); server.middlewares.use(middleware); },
  }] };
});
