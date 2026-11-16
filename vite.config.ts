import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import { createDecisionMiddleware } from './server/decision.ts';
import { createThoughtMiddleware } from './server/thought.ts';
import { createTtsMiddleware } from './server/tts.ts';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, resolve('AI-TEST'), 'ANYROUTER_'), ...loadEnv(mode, process.cwd(), ['ANYROUTER_','GEMINI_']), ...process.env };
  const thought = createThoughtMiddleware({apiKey:env.GEMINI_API_KEY,model:env.GEMINI_MODEL});
  const tts=createTtsMiddleware({apiKey:env.GEMINI_API_KEY,model:env.GEMINI_TTS_MODEL});
  const middleware = createDecisionMiddleware({ apiKey: env.ANYROUTER_API_KEY,
    model: env.ANYROUTER_MODEL, limit: Number(env.ANYROUTER_NPC_LIMIT) || 5 });
  return { plugins: [{ name: 'npc-decisions',
    configureServer(server) { server.middlewares.use(tts); server.middlewares.use(thought); server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(tts); server.middlewares.use(thought); server.middlewares.use(middleware); },
  }] };
});
