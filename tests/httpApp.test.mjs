import { describe, it, expect, vi } from "vitest";
import { createServer } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { image } from "./fixtures/chatImage.mjs";
import app from "../src/http/app.js";
async function withServer(work, overrides = {}) {
  const sessions = new Map();
  const repo = {
    createSession: vi.fn(async row => { sessions.set(row.id, row); return { id: row.id, circuitId: row.circuitId }; }),
    getSessionAccessHash: async id => sessions.get(id)?.accessTokenHash,
    getSession: async id => ({ id, circuitId: "circuit-one" }),
    getItemsForSession: async () => [], getReasoningHistory: async () => [],
  };
  const processTurn = vi.fn(async () => ({ status: "completed", reasoning: { kind: "context_required" } }));
  const server = createServer(app.createApp({ repository: repo, processTurn, perMinute: 100, ...overrides }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, token, headers = {}) => fetch(base + path, { method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(body) });
  const create = async () => (await post("/api/sessions", { circuitId: "circuit-one" })).json();
  try { await work({ base, repo, processTurn, post, create }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
describe("browser API boundary", () => {
  it("stores only a token hash and prevents another session from reading the record", async () => withServer(async ({ create, base, repo }) => {
    const one = await create(), two = await create();
    const stored = repo.createSession.mock.calls[0][0];
    expect(stored.accessTokenHash).toBe(createHash("sha256").update(one.token).digest("hex"));
    expect(one.session).not.toHaveProperty("accessTokenHash");
    expect((await fetch(`${base}/api/sessions/${one.session.id}`)).status).toBe(401);
    expect((await fetch(`${base}/api/sessions/${one.session.id}`, { headers: { Authorization: `Bearer ${two.token}` } })).status).toBe(404);
    expect((await fetch(`${base}/api/sessions/${one.session.id}`, { headers: { Authorization: `Bearer ${one.token}` } })).status).toBe(200);
  }));
  it("rejects context injection and unknown circuits before calling a model", async () => withServer(async ({ create, post, processTurn }) => {
    expect((await post("/api/sessions", { circuitId: "../../evaluation" })).status).toBe(400);
    const one = await create();
    expect((await post(`/api/sessions/${one.session.id}/turns`, { turnId: randomUUID(), userMessage: "LED dark", replyToTurnId: null, requestedSubject: "fake" }, one.token)).status).toBe(400);
    expect(processTurn).not.toHaveBeenCalled();
  }));
  it("does not expose service secrets or reject output as guidance", async () => withServer(async ({ create, post }) => {
    const one = await create();
    const response = await post(`/api/sessions/${one.session.id}/turns`, { turnId: randomUUID(), userMessage: "LED dark", replyToTurnId: null }, one.token);
    expect(response.status).toBe(503);
    const text = await response.text(); expect(text).not.toContain("SECRET"); expect(text).not.toContain("recommendation");
  }, { processTurn: async () => { throw new Error("SECRET from provider"); } }));
  it("does not serve evaluation files or arbitrary source code", async () => withServer(async ({ base }) => {
    for (const path of ["/data/evaluation/circuit-one-ground-truth.json", "/src/config/supabase.js", "/.env"]) {
      expect((await fetch(base + path)).status).toBe(404);
    }
  }));
  it("forwards stable turn IDs to support idempotent retries", async () => withServer(async ({ create, post, processTurn }) => {
    const one = await create(); const input = { turnId: randomUUID(), userMessage: "LED dark", replyToTurnId: null };
    await post(`/api/sessions/${one.session.id}/turns`, input, one.token);
    await post(`/api/sessions/${one.session.id}/turns`, input, one.token);
    expect(processTurn.mock.calls.map(call => call[0].turnId)).toEqual([input.turnId, input.turnId]);
  }));
  it("refuses overlapping requests instead of queueing unlimited model calls", async () => {
    let signalStarted, releaseFirst;
    const started = new Promise(resolve => { signalStarted = resolve; });
    const held = new Promise(resolve => { releaseFirst = resolve; });
    const processor = vi.fn(async () => {
      // Hold only the first call: if the guard breaks, a second call returns
      // immediately and fails the assertion rather than hanging this test.
      if (processor.mock.calls.length === 1) {
        signalStarted();
        await held;
      }
      return { status: "completed" };
    });
    await withServer(async ({ create, post }) => {
      const one = await create();
      const path = `/api/sessions/${one.session.id}/turns`;
      const input = { turnId: randomUUID(), userMessage: "LED dark", replyToTurnId: null };
      const first = post(path, input, one.token);
      try {
        await started;
        const overlapping = await post(path, { ...input, turnId: randomUUID() }, one.token);
        expect(overlapping.status).toBe(429);
        expect(processor).toHaveBeenCalledTimes(1);
      } finally {
        releaseFirst();
        expect((await first).status).toBe(200);
      }
      // Completion must also release the slot for the next legitimate request.
      expect((await post(path, { ...input, turnId: randomUUID() }, one.token)).status).toBe(200);
      expect(processor).toHaveBeenCalledTimes(2);
    }, { processTurn: processor });
  });
  it("rejects unexpected origins before consuming a provider call", async () => withServer(async ({ post, processTurn }) => {
    expect((await post("/api/sessions", { circuitId: "circuit-one" }, null, { Origin: "https://evil.test" })).status).toBe(403);
    expect(processTurn).not.toHaveBeenCalled();
  }, { publicOrigin: "https://freely.test" }));
  it("accepts bounded user context without loading the reviewed demo fixture", async () => {
    const loader = vi.fn(() => { throw new Error("must not load demo"); });
    await withServer(async ({ post, repo }) => {
      const description = "A battery-powered power bank board. Its LED turns on but it does not charge.";
      const response = await post("/api/sessions", { circuitId: "user-board", boardDescription: description });
      expect(response.status).toBe(201);
      expect(repo.createSession.mock.calls[0][0].boardDescription).toBe(description);
      expect(loader).not.toHaveBeenCalled();
      for (const boardDescription of ["", "   ", "a".repeat(2001)]) {
        expect((await post("/api/sessions", { circuitId: "user-board", boardDescription })).status).toBe(400);
      }
      expect((await post("/api/sessions", { circuitId: "user-board", boardDescription: description, trusted: true })).status).toBe(400);
    }, { circuitLoader: loader });
  });
  it("reports a session setup failure with safe diagnostic codes, without logging credentials", async () => {
    const onError = vi.fn();
    const failure = Object.assign(new Error("SECRET credential or report"), { code: "PGRST204" });
    await withServer(async ({ post }) => {
      const response = await post("/api/sessions", { circuitId: "circuit-one" });
      expect(response.status).toBe(503);
      expect((await response.json()).error).toContain("could not start a session");
      expect(onError).toHaveBeenCalledWith({ operation: "create_session", code: "PGRST204" });
      expect(JSON.stringify(onError.mock.calls)).not.toContain("SECRET");
    }, { repository: { createSession: async () => { throw failure; } }, onError });
  });
});

it("validates image envelopes before processing and never accepts remote image URLs", async () => withServer(async ({ create, post, processTurn }) => {
  const one = await create(); const path = `/api/sessions/${one.session.id}/turns`;
  const input = { turnId: randomUUID(), userMessage: "Look at this board", replyToTurnId: null };
  for (const images of [[{ mimeType: "image/jpeg", data: "not-an-image" }], [{ uri: "http://internal/secret" }], [image, image]]) {
    expect((await post(path, { ...input, images }, one.token)).status).toBe(400);
  }
  expect(processTurn).not.toHaveBeenCalled();
  expect((await post(path, { ...input, images: [image] }, one.token)).status).toBe(200);
  expect(processTurn.mock.calls[0][0].images).toEqual([image]);
}));


it("reports a provider timeout safely without presenting it as an answer", async () => {
  const onError = vi.fn();
  await withServer(async ({ create, post }) => {
    const one = await create();
    const response = await post(`/api/sessions/${one.session.id}/turns`, { turnId: randomUUID(), userMessage: "LED dark", replyToTurnId: null }, one.token);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toContain("took too long");
    expect(body.error).not.toContain("SECRET");
    expect(body).not.toHaveProperty("reasoning");
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ stage: "reasoning", failure: "PROVIDER_TIMEOUT" }));
  }, { onError, processTurn: async () => { throw Object.assign(new Error("SECRET request details"), { name: "APIConnectionTimeoutError", processingStage: "reasoning" }); } });
});


it("shows a safe build identifier without consuming model or database calls", async () => {
  await withServer(async ({ base, repo, processTurn }) => {
    const version = await (await fetch(base + '/api/version')).json();
    expect(version).toEqual({ version: 'preview-test-123', status: 'serving' });
    const html = await (await fetch(base)).text();
    expect(html).toContain('preview-test-123');
    expect(html).not.toContain('__FREELY_BUILD__');
    expect(processTurn).not.toHaveBeenCalled();
    expect(repo.createSession).not.toHaveBeenCalled();
  }, { buildId: 'preview-test-123' });
});
it("does not insert HTML from an unsafe deployment label", async () => {
  await withServer(async ({ base }) => {
    const version = await (await fetch(base + '/api/version')).json();
    expect(version.version).toBe('unknown-build');
  }, { buildId: '<script>secret</script>' });
});
