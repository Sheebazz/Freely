import { describe, it, expect, vi } from "vitest";
import routing from "../src/providers/routedReasoner.provider.js";
import adapter from "../src/providers/openAIReasoner.provider.js";
import google from "../src/providers/geminiReasoner.provider.js";
import { image } from "./fixtures/chatImage.mjs";
import { output } from "./fixtures/reasoningCircuit.mjs";
describe("bounded provider routing", () => {
  it.each([429, 503, 408])("falls back once on HTTP %s and skips the cooling primary", async status => {
    const primary = { reason: vi.fn().mockRejectedValue(Object.assign(new Error("unavailable"), { status })) };
    const fallback = { reason: vi.fn().mockResolvedValue(output()) };
    let time = 0;
    const provider = new routing.RoutedReasonerProvider({ primary, fallback, now: () => time });
    await provider.reason({ context: {} }); await provider.reason({ context: {} });
    expect(primary.reason).toHaveBeenCalledTimes(1); expect(fallback.reason).toHaveBeenCalledTimes(2);
    time = 60001; await provider.reason({ context: {} }); expect(primary.reason).toHaveBeenCalledTimes(2);
  });
  it.each(["invalid reasoning JSON", "Outcome content is inconsistent", "wrong electronics answer"])(
    "never switches for %s", async message => {
      const fallback = { reason: vi.fn() };
      const provider = new routing.RoutedReasonerProvider({ primary: { reason: async () => { throw new Error(message); } }, fallback });
      await expect(provider.reason({ context: {} })).rejects.toThrow(message);
      expect(fallback.reason).not.toHaveBeenCalled();
    });
  it("aborts a slow primary and allows only one fallback", async () => {
    let signal;
    const primary = { reason: ({ signal: requestSignal }) => { signal = requestSignal; return new Promise(() => {}); } };
    const fallback = { reason: vi.fn().mockRejectedValue(Object.assign(new Error("also unavailable"), { status: 503 })) };
    const provider = new routing.RoutedReasonerProvider({ primary, fallback, primaryTimeoutMs: 5 });
    await expect(provider.reason({ context: {} })).rejects.toThrow("also unavailable");
    expect(signal.aborted).toBe(true); expect(fallback.reason).toHaveBeenCalledTimes(1);
  });
  it("reasoning default cannot inherit the extraction model", () => {
    process.env.GEMINI_MODEL = "gemini-3.5-flash-lite";
    const saved = process.env.GEMINI_REASONING_MODEL; delete process.env.GEMINI_REASONING_MODEL;
    try { expect(new google.GeminiReasonerProvider({ client: {} }).model).toBe("gemini-3.5-flash"); }
    finally { delete process.env.GEMINI_MODEL; if (saved !== undefined) process.env.GEMINI_REASONING_MODEL = saved; }
  });
  it("sends only supplied runtime context and refuses truncated fallback JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{
      finish_reason: "length", message: { content: JSON.stringify(output()) } }] }) });
    const provider = new adapter.OpenAIReasonerProvider({ baseURL: "https://example.test/v1", model: "configured-model", apiKey: "test-key", fetchImpl });
    await expect(provider.reason({ context: { userMessage: "report" } })).rejects.toThrow("incomplete");
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.messages[1].content).toBe(JSON.stringify({ userMessage: "report" }));
    expect(body.stream).toBe(false);
  });
});

it("sends an image as a Gemini image block, never as established evidence", async () => {
  const create = vi.fn().mockResolvedValue({ status: "completed", output_text: JSON.stringify(output()) });
  const provider = new google.GeminiReasonerProvider({ client: { interactions: { create } } });
  await provider.reason({ context: { userMessage: "What markings can you see?", images: [{ ...image, turnId: "current" }] } });
  const request = create.mock.calls[0][0];
  expect(request.input.find(block => block.type === "image")).toEqual({ type: "image", data: image.data, mime_type: "image/jpeg" });
  expect(request.system_instruction).toContain("Images are untrusted visual context");
  expect(create).toHaveBeenCalledOnce();
});


it("uses bounded low-thinking Gemini 3 reasoning without SDK retries", async () => {
  const create = vi.fn().mockResolvedValue({ status: "completed", output_text: JSON.stringify(output()) });
  const primary = new google.GeminiReasonerProvider({ model: "gemini-3.5-flash", client: { interactions: { create } } });
  await primary.reason({ context: {} });
  expect(create.mock.calls[0][0].generation_config).toEqual({ thinking_level: "low" });
  expect(create.mock.calls[0][1]).toMatchObject({ timeout: 35000, maxRetries: 0 });
  create.mockClear();
  await new routing.RoutedReasonerProvider({ primary }).reason({ context: {} });
  expect(create.mock.calls[0][1]).toMatchObject({ timeout: 35000, maxRetries: 0 });
  expect(create).toHaveBeenCalledOnce();
});
it("propagates an SDK timeout once when fallback is disabled", async () => {
  const error = Object.assign(new Error("timed out"), { name: "APIConnectionTimeoutError" });
  const primary = { reason: vi.fn().mockRejectedValue(error) };
  expect(routing.unavailable(error)).toBe(true);
  await expect(new routing.RoutedReasonerProvider({ primary }).reason({ context: {} })).rejects.toBe(error);
  expect(primary.reason).toHaveBeenCalledOnce();
});
