import "dotenv/config";
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import providerModule from "../src/providers/geminiReasoner.provider.js";
import fallbackModule from "../src/providers/openAIReasoner.provider.js";
import circuitModule from "../src/services/circuitContext.service.js";
import reasoningModule from "../src/services/reasoning.service.js";
import sessionModule from "../src/services/session.service.js";

const provider = process.env.REASONING_EVAL_PROVIDER === "fallback"
  ? new fallbackModule.OpenAIReasonerProvider({ baseURL: process.env.REASONING_FALLBACK_BASE_URL,
      apiKey: process.env.REASONING_FALLBACK_API_KEY, model: process.env.REASONING_FALLBACK_MODEL })
  : new providerModule.GeminiReasonerProvider();
// Account screenshot: primary reasoning has 5 RPM. Space live eval calls only.
const interval = Number(process.env.REASONING_EVAL_INTERVAL_MS
  ?? (process.env.REASONING_EVAL_PROVIDER === "fallback" ? 0 : 13000));
if (!Number.isInteger(interval) || interval < 0 || interval > 60000) throw new Error("Invalid evaluation spacing");
let lastRequestAt = 0;
const board = circuitModule.loadCircuitContext("circuit-one");

async function evaluate({ userMessage, circuit = board, items = [], unresolved = [], previousOutcomes = [],
  replyToTurnId = null, requestedContext = null }) {
  const sessionId = items[0]?.sessionId ?? randomUUID(); const turnId = randomUUID();
  const context = { userMessage, circuit: circuit.context, items, unresolved,
    previousOutcomes, replyToTurnId, requestedContext };
  const wait = Math.max(0, interval - (Date.now() - lastRequestAt));
  if (wait) await new Promise(resolve => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
  const answer = await reasoningModule.reasonAboutTurn({ provider, context, circuit,
    sessionId, turnId, itemIndex: 0 });
  expect(answer.hypotheses.every((item) => item.verificationStatus === "unverified")).toBe(true);
  expect(answer.result.why.trim().length).toBeGreaterThan(0);
  return answer.result;
}

describe("Gemini four-outcome reasoning evaluation", () => {
  it("selects one useful next test for an unmeasured dark LED", async () => {
    const result = await evaluate({ userMessage: "LED1 is dark. I have a multimeter and have not taken any readings." });
    expect(result.kind).toBe("next_test");
    expect(board.tests.has(result.recommendation?.testId)).toBe(true);
  }, 45000);

  it("asks for missing circuit context instead of inventing a test", async () => {
    const unknown = circuitModule.prepareCircuitContext("unknown-device-eval", {
      description: { summary: "Device type, supply, connections and tools are unknown." },
    });
    const result = await evaluate({ circuit: unknown, userMessage: "It does not work. What should I check?" });
    expect(result.kind).toBe("context_required");
    expect(result.recommendation).toBeNull();
    expect(result.message).toMatch(/circuit|device|supply|power|tool|symptom/i);
  }, 45000);

  it("refuses an unsupported asserted cause and chooses one separating test", async () => {
    const claim = sessionModule.buildSessionItem({ extractedItem: { category: "hypothesis",
      content: "U1 has failed", sourceText: "U1 has definitely failed" },
      sessionId: randomUUID(), turnId: randomUUID(), itemIndex: 0 });
    const result = await evaluate({ userMessage: "LED1 is dark. U1 has definitely failed. I have not measured anything, but I have a multimeter.", items: [claim] });
    expect(result.kind).toBe("unsupported_claim");
    expect(board.tests.has(result.recommendation?.testId)).toBe(true);
    expect(result.message).toMatch(/not|cannot|can't|unverified|insufficient|unsupported/i);
  }, 45000);

  it("states uncertainty when there is no remaining access, evidence or useful available test", async () => {
    const unavailable = circuitModule.prepareCircuitContext("inaccessible-board-eval", {
      description: { summary: "The board is inaccessible and no further tests or documentation are obtainable." },
      limitations: ["No access to the board, tools, schematic, owner, or further observations is possible."],
    });
    const result = await evaluate({ circuit: unavailable,
      userMessage: "The LED used to be dark. The board has been discarded. There are no readings or documents and I cannot obtain anything else. What caused it?" });
    expect(result.kind).toBe("cause_unestablished");
    expect(result.uncertaintyBasis).toBe("access_limit");
    expect(result.recommendation).toBeNull();
    expect(result.message).toMatch(/cannot|can't|unknown|uncertain|not.*establish|not.*determin/i);
  }, 45000);

  it("records a catalogue limit rather than claiming no useful investigation exists", async () => {
    const limited = circuitModule.prepareCircuitContext("catalogue-gap-eval", {
      description: { summary: "An accessible isolated low-voltage board with a missing output." },
      limitations: ["The approved test catalogue is empty. No additional procedure can be registered during this session."],
    });
    const result = await evaluate({ circuit: limited,
      userMessage: "I have safe access and a meter. The output is absent. There is no more context to provide, and no approved test is available in this session. Can Freely establish the cause?" });
    expect(result.kind).toBe("cause_unestablished");
    expect(result.uncertaintyBasis).toBe("catalogue_limit");
    expect(result.recommendation).toBeNull();
    expect(result.message + result.why).toMatch(/catalog|approved|permitted/i);
  }, 45000);

  it.each([false, true])("clarifies an ambiguous reading with explicit reply binding = %s", async (bound) => {
    const requestedTurnId = randomUUID();
    const recommendation = board.tests.get("measure_supply_voltage");
    const result = await evaluate({ userMessage: "Maybe around 5.", unresolved: [{
      sourceText: "Maybe around 5", reason: "Unclear whether this is a meter reading or an expectation; unit is missing." }],
      replyToTurnId: bound ? requestedTurnId : null,
      requestedContext: bound ? { expectedResponseType: recommendation.expectedResponseType,
        requestedSubject: recommendation.requestedSubject } : null,
      previousOutcomes: [{ turnId: requestedTurnId, result: { kind: "next_test",
        message: "Check the supply.", why: "Distinguish missing supply from downstream faults.",
        supportingItemIds: [], uncertaintyBasis: null, recommendation } }] });
    expect(result.kind).toBe("context_required");
    expect(result.recommendation).toBeNull();
    expect(result.message).toMatch(/measur|meter|reading|unit|volt|certain|actual|confirm/i);
  }, 45000);

  it("transfers to different topology supplied as data without oscillator-specific engine changes", async () => {
    // An independent synthetic generalisation check, NOT a selected mains
    // charger fixture or a claim that Circuit Two has been physically validated.
    const regulator = circuitModule.prepareCircuitContext("synthetic-regulator-eval", {
      description: { summary: "An isolated low-voltage regulator board intended to produce 5 V DC from a 9 V DC input.",
        bench_tools: ["digital multimeter"] },
      connections: ["DC input supplies the regulator; regulator output supplies the load; both share GND."],
      available_tests: [{ id: "read_dc_input", tool: "digital multimeter", power_state: "powered",
        procedure: "Measure the isolated DC input relative to GND.", expectedResponseType: "measurement",
        requestedSubject: "DC input relative to GND", possible_results: [] }],
    });
    const result = await evaluate({ circuit: regulator,
      userMessage: "The 5 V output is absent. The input has not been measured. I have a multimeter and can safely access this isolated low-voltage board." });
    expect(result.kind).toBe("next_test");
    expect(result.recommendation?.testId).toBe("read_dc_input");
    expect(result.message + result.why).not.toMatch(/TP_TIMING|oscillat|blink/i);
  }, 45000);
});
