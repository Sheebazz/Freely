import { describe, it, expect } from "vitest";

import geminiProviderModule from "../src/providers/geminiExtractor.provider.js";
import extractionService from "../src/services/extraction.service.js";

const { GeminiExtractorProvider } = geminiProviderModule;
const { extractUserMessage } = extractionService;

const provider = new GeminiExtractorProvider();

describe("Gemini extractor semantic regression", () => {
  it("classifies a diagnostic claim as hypothesis", async () => {
    const result = await extractUserMessage({
      provider,
      userMessage: "I think U1 is bad.",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].category).toBe("hypothesis");
    expect(result.unresolved).toHaveLength(0);
  }, 15000);

  it("does not turn an uncertain voltage statement into evidence", async () => {
    const result = await extractUserMessage({
      provider,
      userMessage: "I think it's around 5 volts.",
    });

    expect(result.items).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
  }, 15000);

  it("classifies an explicit meter reading as measurement evidence", async () => {
    const result = await extractUserMessage({
      provider,
      userMessage: "The meter says 5.02 V.",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].category).toBe("evidence");
    expect(result.items[0].kind).toBe("measurement");
    expect(result.unresolved).toHaveLength(0);
  }, 15000);

  it("classifies a directly described visual state as observation", async () => {
    const result = await extractUserMessage({
      provider,
      userMessage: "I think the LED looks dim.",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].category).toBe("observation");
    expect(result.unresolved).toHaveLength(0);
  }, 15000);

  it("leaves an ungrounded bare value unresolved", async () => {
    const result = await extractUserMessage({
      provider,
      userMessage: "Maybe around 330.",
    });

    expect(result.items).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
  }, 15000);

  it("uses minimal turn context to resolve the subject of a clear measurement reply", async () => {
    const result = await extractUserMessage({
      provider,
      userMessage: "It reads 4.8 volts.",
      turnContext: {
        expectedResponseType: "measurement",
        requestedSubject: "TP1 voltage relative to ground",
      },
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].category).toBe("evidence");
    expect(result.items[0].kind).toBe("measurement");
    expect(result.items[0].subject).toContain("TP1");
    expect(result.unresolved).toHaveLength(0);
  }, 15000);

  it("does not let expected measurement context turn an uncertain reply into evidence", async () => {
    const result = await extractUserMessage({
      provider,
      userMessage: "I think it's 4.8 volts.",
      turnContext: {
        expectedResponseType: "measurement",
        requestedSubject: "TP1 voltage relative to ground",
      },
    });

    expect(result.items).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
  }, 30000);


  it("targets an explicit correction using only the provided temporary ref", async () => {
    const result = await extractUserMessage({
      provider,
      userMessage: "Actually TP1 was 4.8 V, not 5.02 V.",
      correctionCandidates: [
        {
          ref: "candidate-a",
          category: "evidence",
          kind: "measurement",
          content: "TP1 measured 5.02 V",
          subject: "TP1",
          value: 5.02,
          unit: "V",
        },
      ],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].kind).toBe("measurement");
    expect(result.items[0].value).toBe(4.8);
    expect(result.items[0].correctionRef).toBe("candidate-a");
    expect(result.unresolved).toHaveLength(0);
  }, 30000);

  it("does not silently turn a fresh repeat measurement into a correction", async () => {
    const result = await extractUserMessage({
      provider,
      userMessage: "I measured TP1 again and got 4.8 V.",
      correctionCandidates: [
        {
          ref: "candidate-a",
          category: "evidence",
          kind: "measurement",
          content: "TP1 measured 5.02 V",
          subject: "TP1",
          value: 5.02,
          unit: "V",
        },
      ],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].kind).toBe("measurement");
    expect(result.items[0].value).toBe(4.8);
    expect(result.items[0].correctionRef ?? null).toBeNull();
    expect(result.unresolved).toHaveLength(0);
  }, 30000);

  it("does not guess when an intended correction has multiple plausible targets", async () => {
    const result = await extractUserMessage({
      provider,
      userMessage: "Actually TP1 was 4.8 V.",
      correctionCandidates: [
        {
          ref: "candidate-a",
          category: "evidence",
          kind: "measurement",
          content: "TP1 measured 5.02 V during startup",
          subject: "TP1",
          value: 5.02,
          unit: "V",
        },
        {
          ref: "candidate-b",
          category: "evidence",
          kind: "measurement",
          content: "TP1 measured 4.95 V after startup",
          subject: "TP1",
          value: 4.95,
          unit: "V",
        },
      ],
    });

    expect(result.items).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
  }, 30000);

  it("keeps an appearance-based component identity as a hypothesis", async () => {
    const result = await extractUserMessage({
      provider,
      userMessage: "It looks like a 555, so I think that is U1.",
    });

    // Multiple distinct identity claims may be extracted from these clauses.
    // The safety contract concerns classification, not an arbitrary item count.
    expect(result.items.length, JSON.stringify(result)).toBeGreaterThan(0);
    expect(result.items.every((item) => item.category === "hypothesis"),
      JSON.stringify(result)).toBe(true);
    expect(result.items.some((item) => item.sourceText.includes("555"))).toBe(true);
    expect(result.unresolved).toHaveLength(0);
  }, 30000);

  it("does not manufacture a measurement from an expected voltage", async () => {
    const result = await extractUserMessage({
      provider,
      userMessage: "TP1 should be 5 V.",
      turnContext: {
        expectedResponseType: "measurement",
        requestedSubject: "TP1 voltage relative to ground",
      },
    });
    expect(result.items).toHaveLength(0);
    expect(result.unresolved.length).toBeGreaterThan(0);
  }, 30000);

  it("does not treat a plausible voltage span in an unperformed test as evidence", async () => {
    const result = await extractUserMessage({ provider,
      userMessage: "I have not measured TP1; I only expect TP1 to read 5.02 V.",
      turnContext: { expectedResponseType: "measurement", requestedSubject: "TP1 voltage relative to ground" },
    });
    expect(result.status === "clarification_required" ||
      result.items.every(item => item.category !== "evidence"), JSON.stringify(result)).toBe(true);
  }, 30000);

  it("does not invent volts for a unitless instrument reading", async () => {
    const result = await extractUserMessage({ provider,
      userMessage: "I measured 5.02 at the input.",
    });
    // Either honest clarification or a reading with explicitly unknown unit is safe.
    expect(result.status === "clarification_required" || result.items.every(item =>
      item.category !== "evidence" || item.kind !== "measurement" || item.unit === null),
      JSON.stringify(result)).toBe(true);
  }, 30000);

});
