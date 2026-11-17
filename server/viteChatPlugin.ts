import type { Connect } from "vite";
import type { Plugin } from "vite";
import { loadEnv } from "vite";
import { completeChat, completeChatDemo, getLlmConfig, type ChatCompletionBody } from "./chatLlm";

/** 요청 본문 최대 크기 (OpenAI 비용·메모리 남용 방지) */
const MAX_BODY_BYTES = 64 * 1024;
const MAX_HISTORY = 40;
const MAX_TEXT = 4000;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function readJsonBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      if (tooLarge) return; // 이미 거절했으면 남은 본문은 버린다 (연결을 끊지 않아야 413 응답이 전달된다)
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        reject(new HttpError(413, "요청이 너무 큽니다."));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** 다른 사이트의 페이지가 사용자의 브라우저로 이 API를 부르는 것(CSRF)을 막는다 */
function assertSameOrigin(req: Connect.IncomingMessage) {
  const origin = req.headers.origin;
  if (origin) {
    let originHost = "";
    try { originHost = new URL(origin).host; } catch { /* 잘못된 값 */ }
    if (!originHost || originHost !== req.headers.host) {
      throw new HttpError(403, "허용되지 않은 출처의 요청입니다.");
    }
  }
  // 다른 사이트의 단순 요청(text/plain 등)은 JSON 헤더를 붙일 수 없다
  const type = String(req.headers["content-type"] ?? "").toLowerCase();
  if (!type.startsWith("application/json")) {
    throw new HttpError(415, "Content-Type 은 application/json 이어야 합니다.");
  }
}

function parseBody(raw: string): ChatCompletionBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "JSON 형식이 올바르지 않습니다.");
  }
  if (!parsed || typeof parsed !== "object") throw new HttpError(400, "요청 형식이 올바르지 않습니다.");
  const body = parsed as ChatCompletionBody;
  if (typeof body.message !== "string" || !body.message.trim() || body.message.length > MAX_TEXT) {
    throw new HttpError(400, "message 는 1~4000자의 문자열이어야 합니다.");
  }
  if (body.history !== undefined) {
    if (!Array.isArray(body.history)) throw new HttpError(400, "history 는 배열이어야 합니다.");
    // 오래된 대화는 잘라 보낸다
    body.history = body.history
      .slice(-MAX_HISTORY)
      .filter(h => h && typeof h.text === "string")
      .map(h => ({ role: h.role === "user" ? "user" : "ai", text: h.text.slice(0, MAX_TEXT) }));
  }
  return body;
}

function attachChatMiddleware(
  middlewares: Connect.Server,
  env: Record<string, string>,
) {
  middlewares.use(async (req, res, next) => {
    const url = req.url?.split("?")[0];
    if (url !== "/api/chat/completions") return next();
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ message: "Method Not Allowed" }));
      return;
    }

    const config = getLlmConfig(env);

    try {
      assertSameOrigin(req);
      const raw = await readJsonBody(req);
      const body = parseBody(raw);

      if (!config) {
        const demo = completeChatDemo(body);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ text: demo.text, meta: { provider: "llm", demo: true } }));
        return;
      }

      const { text } = await completeChat(body, config);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ text, meta: { provider: "llm" } }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "LLM 처리 실패";
      res.statusCode = err instanceof HttpError ? err.status : 502;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ message }));
    }
  });
}

export function chatApiPlugin(): Plugin {
  return {
    name: "bredred-chat-api",
    configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.root, "");
      attachChatMiddleware(server.middlewares, env);
    },
    configurePreviewServer(server) {
      const env = loadEnv("production", server.config.root, "");
      attachChatMiddleware(server.middlewares, env);
    },
  };
}
