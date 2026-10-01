import { describe, it, expect, vi } from "vitest";

import extractionService from "../src/services/extraction.service.js";

const {
  extractUserMessage,
} = extractionService;

const USER_MESSAGE =
  "The LED stays dark and I measured 4.8 V at TP1. I think U1 is bad.";

describe("extraction service", () => {
  it("accepts valid extraction without calling repair", async () => {
    let repairCalls = 0;

    const provider = {
      async extract() {
        return {
          items: [
            {
              category: "observation",
              content: "The LED stays dark",
              sourceText: "The LED stays dark",
            },
          ],
          unresolved: [],
        };
      },

      async repair() {
        repairCalls += 1;
        throw new Error("repair should not be called");
      },
    };

    const result = await extractUserMessage({
      provider,
      userMessage: USER_MESSAGE,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].category).toBe("observation");
    expect(repairCalls).toBe(0);
  });

  it("repairs an invented sourceText once", async () => {
    let repairCalls = 0;

    const provider = {
      async extract() {
        return {
          items: [
            {
              category: "evidence",
              kind: "measurement",
              subject: "TP1",
              value: 4.8,
              unit: "V",
              content: "TP1 measured 4.8 V",
              sourceText: "TP1 was exactly 4.8 volts",
            },
          ],
          unresolved: [],
        };
      },

      async repair() {
        repairCalls += 1;

        return {
          items: [
            {
              category: "evidence",
              kind: "measurement",
              subject: "TP1",
              value: 4.8,
              unit: "V",
              content: "TP1 measured 4.8 V",
              sourceText: "I measured 4.8 V at TP1",
            },
          ],
          unresolved: [],
        };
      },
    };

    const result = await extractUserMessage({
      provider,
      userMessage: USER_MESSAGE,
    });

    expect(result.items[0].sourceText)
      .toBe("I measured 4.8 V at TP1");

    expect(repairCalls).toBe(1);
  });

  it("repairs structurally invalid model output once", async () => {
    let repairCalls = 0;

    const provider = {
      async extract() {
        return {
          items: [
            {
              category: "confirmed_fact",
              content: "U1 is bad",
              sourceText: "I think U1 is bad",
            },
          ],
          unresolved: [],
        };
      },

      async repair() {
        repairCalls += 1;

        return {
          items: [
            {
              category: "hypothesis",
              content: "U1 may be faulty",
              sourceText: "I think U1 is bad",
            },
          ],
          unresolved: [],
        };
      },
    };

    const result = await extractUserMessage({
      provider,
      userMessage: USER_MESSAGE,
    });

    expect(result.items[0].category).toBe("hypothesis");
    expect(repairCalls).toBe(1);
  });

  it("repairs duplicate classifications of the same source span once", async () => {
    const provider = {
      extract: vi.fn().mockResolvedValue({
        items: [
          {
            category: "observation",
            content: "The LED stays dark",
            sourceText: "The LED stays dark",
          },
          {
            category: "hypothesis",
            content: "The LED stays dark",
            sourceText: "The LED stays dark",
          },
        ],
        unresolved: [],
      }),
      repair: vi.fn().mockResolvedValue({
        items: [
          {
            category: "observation",
            content: "The LED stays dark",
            sourceText: "The LED stays dark",
          },
        ],
        unresolved: [],
      }),
    };

    const result = await extractUserMessage({
      provider,
      userMessage: "The LED stays dark.",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].category).toBe("observation");
    expect(provider.repair).toHaveBeenCalledOnce();
    expect(provider.repair.mock.calls[0][0].reason)
      .toContain("cannot classify more than one item");
  });

  it("does not enter an endless repair loop", async () => {
    let repairCalls = 0;

    const provider = {
      async extract() {
        return {
          items: [
            {
              category: "observation",
              content: "The LED stays dark",
              sourceText: "something the user never said",
            },
          ],
          unresolved: [],
        };
      },

      async repair() {
        repairCalls += 1;

        return {
          items: [
            {
              category: "observation",
              content: "The LED stays dark",
              sourceText: "still not in the message",
            },
          ],
          unresolved: [],
        };
      },
    };

    const result = await extractUserMessage({
      provider,
      userMessage: USER_MESSAGE,
    });

    expect(result.status).toBe("clarification_required");
    expect(result.reason).toBe("extraction_unrecoverable");
    expect(repairCalls).toBe(1);
  });

  it("returns semantically ambiguous spans as unresolved instead of forcing a category", async () => {
    const userMessage =
      "I think it's around 5 volts there.";

    const provider = {
      async extract() {
        return {
          items: [],
          unresolved: [
            {
              sourceText: "I think it's around 5 volts",
              reason: "unclear whether this is a meter measurement or an estimate",
            },
          ],
        };
      },

      async repair() {
        throw new Error("repair should not be called");
      },
    };

    const result = await extractUserMessage({
      provider,
      userMessage,
    });

    expect(result.items).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].sourceText)
      .toBe("I think it's around 5 volts");
  });


  it("repairs unresolved output whose sourceText was not actually said by the user", async () => {
    const userMessage =
      "I think it's around 5 volts there.";

    let repairCalls = 0;

    const provider = {
      async extract() {
        return {
          items: [],
          unresolved: [
            {
              sourceText: "the meter definitely reads 5 volts",
              reason: "unclear whether this is a measurement",
            },
          ],
        };
      },

      async repair() {
        repairCalls += 1;

        return {
          items: [],
          unresolved: [
            {
              sourceText: "I think it's around 5 volts",
              reason: "unclear whether this is a measurement or an estimate",
            },
          ],
        };
      },
    };

    const result = await extractUserMessage({
      provider,
      userMessage,
    });

    expect(result.items).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].sourceText)
      .toBe("I think it's around 5 volts");
    expect(repairCalls).toBe(1);
  });


  it("passes minimal turn context to the extractor provider", async () => {
    let receivedInput = null;

    const provider = {
      async extract(input) {
        receivedInput = input;

        return {
          items: [
            {
              category: "evidence",
              kind: "measurement",
              subject: "TP1",
              value: 4.8,
              unit: "V",
              content: "TP1 measured 4.8 V",
              sourceText: "It reads 4.8 volts.",
            },
          ],
          unresolved: [],
        };
      },

      async repair() {
        throw new Error("repair should not be called");
      },
    };

    const turnContext = {
      expectedResponseType: "measurement",
      requestedSubject: "TP1 voltage relative to ground",
    };

    await extractUserMessage({
      provider,
      userMessage: "It reads 4.8 volts.",
      turnContext,
    });

    expect(receivedInput).toEqual({
      userMessage: "It reads 4.8 volts.",
      turnContext,
      correctionCandidates: [],
    });
  });


  it("passes validated correction candidates to the extractor provider", async () => {
    let receivedCandidates = null;

    const correctionCandidates = [
      {
        ref: "candidate-a",
        category: "evidence",
        kind: "measurement",
        content: "TP1 measured 5.02 V",
        subject: "TP1",
        value: 5.02,
        unit: "V",
      },
    ];

    const provider = {
      async extract(input) {
        receivedCandidates = input.correctionCandidates;

        return {
          items: [
            {
              category: "evidence",
              kind: "measurement",
              subject: "TP1",
              value: 4.8,
              unit: "V",
              content: "TP1 corrected to 4.8 V",
              sourceText: "Actually TP1 was 4.8 V",
              correctionRef: "candidate-a",
            },
          ],
          unresolved: [],
        };
      },

      async repair() {
        throw new Error("repair should not be called");
      },
    };

    const result = await extractUserMessage({
      provider,
      userMessage: "Actually TP1 was 4.8 V.",
      correctionCandidates,
    });

    expect(receivedCandidates).toEqual(correctionCandidates);
    expect(result.items[0].correctionRef).toBe("candidate-a");
  });

  it("repairs a correctionRef that was not provided by the backend", async () => {
    let repairCalls = 0;

    const correctionCandidates = [
      {
        ref: "candidate-a",
        category: "observation",
        content: "The LED stays dark",
      },
    ];

    const provider = {
      async extract() {
        return {
          items: [
            {
              category: "observation",
              content: "The LED is dim",
              sourceText: "Actually the LED is dim",
              correctionRef: "candidate-invented",
            },
          ],
          unresolved: [],
        };
      },

      async repair(input) {
        repairCalls += 1;
        expect(input.correctionCandidates).toEqual(correctionCandidates);

        return {
          items: [
            {
              category: "observation",
              content: "The LED is dim",
              sourceText: "Actually the LED is dim",
              correctionRef: "candidate-a",
            },
          ],
          unresolved: [],
        };
      },
    };

    const result = await extractUserMessage({
      provider,
      userMessage: "Actually the LED is dim.",
      correctionCandidates,
    });

    expect(result.items[0].correctionRef).toBe("candidate-a");
    expect(repairCalls).toBe(1);
  });

  it("rejects duplicate correction candidate refs before calling the provider", async () => {
    let extractCalls = 0;

    const duplicate = {
      ref: "candidate-a",
      category: "observation",
      content: "The LED stays dark",
    };

    const provider = {
      async extract() {
        extractCalls += 1;
        return { items: [], unresolved: [] };
      },
    };

    await expect(
      extractUserMessage({
        provider,
        userMessage: "The LED stays dark.",
        correctionCandidates: [duplicate, { ...duplicate }],
      })
    ).rejects.toThrow("refs must be unique");

    expect(extractCalls).toBe(0);
  });


  it("downgrades a guessed correction target when multiple structurally matching current items exist", async () => {
    const provider = {
      async extract() {
        return {
          items: [
            {
              category: "evidence",
              kind: "measurement",
              subject: "TP1",
              value: 4.8,
              unit: "V",
              content: "TP1 measured 4.8 V",
              sourceText: "Actually TP1 was 4.8 V",
              correctionRef: "candidate-a",
            },
          ],
          unresolved: [],
        };
      },

      async repair() {
        throw new Error("repair should not be called");
      },
    };

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
    expect(result.unresolved[0].reason)
      .toContain("multiple current session items");
  });

  it("does not duplicate an unresolved span when backend correction ambiguity matches model unresolved output", async () => {
    const provider = {
      async extract() {
        return {
          items: [
            {
              category: "evidence",
              kind: "measurement",
              subject: "TP1",
              value: 4.8,
              unit: "V",
              content: "TP1 measured 4.8 V",
              sourceText: "Actually TP1 was 4.8 V",
              correctionRef: "candidate-a",
            },
          ],
          unresolved: [
            {
              sourceText: "Actually TP1 was 4.8 V",
              reason: "the correction target is unclear",
            },
          ],
        };
      },
    };

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
    expect(result.unresolved[0].reason)
      .toContain("multiple current session items");
  });

});
