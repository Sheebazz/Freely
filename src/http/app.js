const { createHash, randomUUID, randomBytes, timingSafeEqual } = require("node:crypto");
const { readFile } = require("node:fs/promises");
const { join } = require("node:path");
const { z } = require("zod");
const { loadCircuitContext, prepareUserBoardContext } = require("../services/circuitContext.service");
const { processUserTurn } = require("../services/turnProcessing.service");
const { imagesSchema } = require("../models/chatInput.schema");
const sha = value => createHash("sha256").update(value).digest("hex");
const bodySchema = z.object({ turnId: z.uuid(), userMessage: z.string().min(1).max(4000)
  .refine(v => v.trim().length > 0), replyToTurnId: z.uuid().nullable(), images: imagesSchema.optional() }).strict();
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
async function readJSON(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= 750000) chunks.push(chunk);
  }
  if (size > 750000) throw new HttpError(413, "Report is too large");
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new HttpError(400, "Expected JSON"); }
}
function createApp({ repository, extractor, reasoner, publicOrigin = null,
  buildId = process.env.RENDER_GIT_COMMIT || process.env.FREELY_BUILD_ID || "preview-delivery-r1",
  maxConcurrent = 2, perMinute = 8, now = Date.now, circuitLoader = loadCircuitContext,
  processTurn = processUserTurn, publicDir = join(__dirname, "../../public"),
  onError = event => console.error("Freely API failure:", JSON.stringify(event)) }) {
  const version = /^[a-zA-Z0-9._-]{1,80}$/.test(buildId) ? buildId : "unknown-build";
  let active = 0; const busySessions = new Set(); const rates = new Map();
  function rate(key) {
    const time = now(); const previous = rates.get(key);
    const entry = !previous || time - previous.start >= 60000 ? { start: time, count: 0 } : previous;
    if (entry.count >= perMinute) throw new HttpError(429, "Please wait a moment before trying again");
    entry.count++; rates.set(key, entry);
    if (rates.size > 1000) for (const [k, v] of rates) if (time - v.start >= 60000) rates.delete(k);
    if (rates.size > 2000) throw new HttpError(503, "Freely is busy. Please try later");
  }
  async function authorize(req, id) {
    const token = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization || "")?.[1];
    if (!token) throw new HttpError(401, "Session access is required");
    const expected = await repository.getSessionAccessHash(id);
    if (!expected || !/^[0-9a-f]{64}$/.test(expected)
      || !timingSafeEqual(Buffer.from(expected), Buffer.from(sha(token)))) {
      throw new HttpError(404, "Session not found");
    }
  }
  const send = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };
  return async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data: blob:; frame-ancestors 'none'; base-uri 'none'");
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      if (req.method === "GET" && path === "/api/version") { send(res, 200, { version, status: "serving" }); return; }
      if (!path.startsWith("/api/")) {
        const files = { "/": ["index.html", "text/html"], "/app.js": ["app.js", "text/javascript"], "/style.css": ["style.css", "text/css"] };
        if (req.method !== "GET" || !files[path]) throw new HttpError(404, "Not found");
        const [file, type] = files[path];
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
        const content = await readFile(join(publicDir, file));
        res.end(file === "index.html" ? content.toString("utf8").replace("__FREELY_BUILD__", version) : content); return;
      }
      if (req.method === "POST") {
        if (publicOrigin && req.headers.origin !== publicOrigin) throw new HttpError(403, "Use the Freely interface to send a report");
        if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) throw new HttpError(415, "Expected JSON");
        // Do not trust client-supplied forwarded headers. This is a single-process MVP limiter.
        rate(req.socket.remoteAddress || "unknown");
      }
      if (req.method === "POST" && path === "/api/sessions") {
        const input = z.discriminatedUnion("circuitId", [
          z.object({ circuitId: z.literal("circuit-one") }).strict(),
          z.object({ circuitId: z.literal("user-board"), boardDescription: z.string().min(1).max(2000)
            .refine(v => v.trim().length > 0) }).strict(),
        ]).parse(await readJSON(req));
        if (input.circuitId === "user-board") prepareUserBoardContext(input.boardDescription);
        else circuitLoader(input.circuitId);
        const token = randomBytes(32).toString("hex"); const id = randomUUID();
        const session = await repository.createSession({ id, circuitId: input.circuitId,
          ...(input.circuitId === "user-board" ? { boardDescription: input.boardDescription } : {}),
          accessTokenHash: sha(token), createdAt: new Date().toISOString() });
        send(res, 201, { session, token }); return;
      }
      const match = /^\/api\/sessions\/([0-9a-f-]{36})(\/turns)?$/.exec(path);
      if (!match) throw new HttpError(404, "Not found");
      const id = z.uuid().parse(match[1]); await authorize(req, id);
      if (req.method === "GET" && !match[2]) {
        const [session, items, turns, inputs] = await Promise.all([repository.getSession(id),
          repository.getItemsForSession(id), repository.getReasoningHistory(id),
          repository.getChatInputs ? repository.getChatInputs(id) : []]);
        send(res, 200, { session, items, turns, inputs }); return;
      }
      if (req.method !== "POST" || !match[2]) throw new HttpError(405, "Method not allowed");
      const input = bodySchema.parse(await readJSON(req));
      if (active >= maxConcurrent || busySessions.has(id)) throw new HttpError(429, "A report is already being processed. Please wait");
      active++; busySessions.add(id);
      try {
        const result = await processTurn({ repository, provider: extractor, reasoningProvider: reasoner,
          sessionId: id, ...input, circuitLoader });
        send(res, result.status === "processing" ? 202 : 200, result);
      } finally { active--; busySessions.delete(id); }
    } catch (error) {
      // Provider/repository errors can contain sensitive request details. Never return them.
      const status = error instanceof HttpError ? error.status : error instanceof z.ZodError && !error.processingStage ? 400 : 503;
      if (status === 503) {
        const operation = req.method === "POST" && req.url === "/api/sessions" ? "create_session" : "session_request";
        // Codes only: never log provider bodies, credentials, tokens or report text.
        const code = typeof error.code === "string" && /^[A-Z0-9]{3,12}$/.test(error.code) ? error.code : "UNCLASSIFIED";
        const stage = ["session", "extraction", "reasoning", "persistence"].includes(error.processingStage) ? error.processingStage : undefined;
        const providerStatus = [400, 401, 403, 404, 408, 429, 500, 502, 503, 504].includes(Number(error.status || error.code))
          ? Number(error.status || error.code) : undefined;
        const knownFailure = ["AbortError", "TimeoutError", "APIConnectionTimeoutError"].includes(error.name) ? "PROVIDER_TIMEOUT"
          : /outside the circuit catalogue/.test(error.message || "") ? "TEST_NOT_ALLOWED"
          : /multiple|list of actions|Outcome content is inconsistent/.test(error.message || "") ? "OUTCOME_REJECTED"
          : /Circuit context changed/.test(error.message || "") ? "CONTEXT_CHANGED"
          : /Session changed/.test(error.message || "") ? "STALE_STATE"
          : /references an unknown|superseded item/.test(error.message || "") ? "INVALID_REFERENCE"
          : /budget|image limit/.test(error.message || "") ? "CONTEXT_LIMIT" : undefined;
        onError({ operation, code, ...(stage ? { stage } : {}), ...(providerStatus ? { providerStatus } : {}),
          ...(knownFailure ? { failure: knownFailure } : {}) });
      }
      send(res, status, { error: status === 503
        ? req.method === "POST" && req.url === "/api/sessions"
          ? "Freely could not start a session. Check the server diagnostic and database setup, then try again."
          : Number(error.status || error.code) === 429
            ? "The AI service has reached a usage limit. Your message is saved. Wait before retrying."
            : ["AbortError", "TimeoutError", "APIConnectionTimeoutError"].includes(error.name)
              ? "The AI service took too long to respond. You can retry this message; it has not been answered yet."
              : "I couldn’t finish this message. You can retry it or edit it and send again."
        : error instanceof z.ZodError ? "Please check the report fields" : error.message });
    }
  };
}
module.exports = { createApp };
