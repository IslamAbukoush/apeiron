import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = resolve("public");
const ANYROUTER_URL = "https://anyrouter.dev/api/v1/decisions";
const DECISION_MODEL = "vllm-sr/d3-ultra";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 100_000) throw new Error("Request body is too large");
  }
  return JSON.parse(body || "{}");
}

function validGameState(state) {
  return state
    && Number.isInteger(state.board?.width)
    && Number.isInteger(state.board?.height)
    && Array.isArray(state.snake)
    && state.snake.length >= 2
    && state.food
    && Array.isArray(state.safeMoves);
}

async function handleDecision(request, response) {
  if (!process.env.ANYROUTER_API_KEY) {
    return sendJson(response, 500, { error: "ANYROUTER_API_KEY is not configured" });
  }

  try {
    const state = await readJson(request);
    if (!validGameState(state)) {
      return sendJson(response, 400, { error: "Invalid Snake state" });
    }

    const startedAt = performance.now();
    const upstream = await fetch(ANYROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.ANYROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DECISION_MODEL,
        state,
        questions: {
          move: {
            type: "choice",
            instructions: "Choose the single best next move in Snake. Survival is mandatory: choose from safeMoves, never reverse into the neck, and avoid trapping the head. Then prefer reaching food efficiently while keeping the largest open escape area.",
            criteria: {
              UP: "Move the head one cell up",
              DOWN: "Move the head one cell down",
              LEFT: "Move the head one cell left",
              RIGHT: "Move the head one cell right"
            }
          }
        }
      }),
    });

    const data = await upstream.json();
    const latencyMs = Math.round(performance.now() - startedAt);
    if (!upstream.ok) {
      return sendJson(response, upstream.status, {
        error: data.error?.message || data.message || "AnyRouter request failed",
        code: data.error?.code,
      });
    }

    const answer = data.answers?.move;
    if (!answer?.choice) {
      return sendJson(response, 502, { error: "Decision response did not contain a move" });
    }

    return sendJson(response, 200, {
      move: answer.choice,
      confidence: answer.confidence,
      probabilities: answer.probabilities,
      model: data.model,
      cost: data.usage?.cost ?? 0,
      latencyMs,
    });
  } catch (error) {
    return sendJson(response, 500, { error: error.message || "Decision request failed" });
  }
}

async function serveStatic(request, response) {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = resolve(PUBLIC_DIR, relativePath);

  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${sep}`)) {
    response.writeHead(403);
    return response.end("Forbidden");
  }

  try {
    const file = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(file);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/api/decision") {
    return handleDecision(request, response);
  }
  if (request.method === "GET") return serveStatic(request, response);
  response.writeHead(405, { Allow: "GET, POST" });
  response.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`AnyRouter Snake running at http://localhost:${PORT}`);
});

