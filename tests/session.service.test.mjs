import { describe, it, expect } from "vitest";

import sessionService from "../src/services/session.service.js";

const {
  buildCorrectionContext,
  buildSessionItem,
  currentItems,
  resolveCorrectionRef,
  validateCorrection,
  validateSourceText,
} = sessionService;

const SESSION_A = "11111111-1111-4111-8111-111111111111";
const SESSION_B = "22222222-2222-4222-8222-222222222222";
const TURN_1 = "33333333-3333-4333-8333-333333333333";
const TURN_2 = "44444444-4444-4444-8444-444444444444";

describe("session service", () => {
  it("backend stamps observation provenance", () => {
    const item = buildSessionItem({
      extractedItem: {
        category: "observation",
        content: "The LED stays dark",
        sourceText: "The LED stays dark",
      },
      sessionId: SESSION_A,
      turnId: TURN_1,
      itemIndex: 0,
      createdAt: "2026-09-29T14:00:00.000Z",
    });

    expect(item.category).toBe("observation");
    expect(item.sessionId).toBe(SESSION_A);
    expect(item.turnId).toBe(TURN_1);
    expect(item.provenance).toEqual({
      actor: "user",
      method: "reported_observation",
    });
  });

  it("backend stamps measurement provenance", () => {
    const item = buildSessionItem({
      extractedItem: {
        category: "evidence",
        kind: "measurement",
        subject: "TP_SUPPLY",
        value: 4.8,
        unit: "V",
        content: "TP_SUPPLY measured 4.8 V",
        sourceText: "TP_SUPPLY measured 4.8 V",
      },
      sessionId: SESSION_A,
      turnId: TURN_1,
      itemIndex: 0,
    });

    expect(item.provenance.method).toBe("reported_measurement");
  });

  it("backend stamps hypothesis provenance without promoting it", () => {
    const item = buildSessionItem({
      extractedItem: {
        category: "hypothesis",
        content: "U1 may be faulty",
        sourceText: "U1 may be faulty",
      },
      sessionId: SESSION_A,
      turnId: TURN_1,
      itemIndex: 0,
    });

    expect(item.category).toBe("hypothesis");
    expect(item.provenance.method).toBe("reported_claim");
    expect(item.established).toBeUndefined();
  });

  it("current view removes stale superseded items", () => {
    const oldItem = buildSessionItem({
      extractedItem: {
        category: "evidence",
        kind: "measurement",
        subject: "TP_SUPPLY",
        value: 5.02,
        unit: "V",
        content: "TP_SUPPLY measured 5.02 V",
        sourceText: "TP_SUPPLY measured 5.02 V",
      },
      sessionId: SESSION_A,
      turnId: TURN_1,
      itemIndex: 0,
    });

    const correctedItem = buildSessionItem({
      extractedItem: {
        category: "evidence",
        kind: "measurement",
        subject: "TP_SUPPLY",
        value: 4.8,
        unit: "V",
        content: "Corrected TP_SUPPLY measurement is 4.8 V",
        sourceText: "actually TP_SUPPLY is 4.8 V",
        correctionRef: "candidate-test",
      },
      resolvedSupersedesId: oldItem.id,
      sessionId: SESSION_A,
      turnId: TURN_2,
      itemIndex: 0,
    });

    const current = currentItems([oldItem, correctedItem]);

    expect(current).toHaveLength(1);
    expect(current[0].value).toBe(4.8);
  });

  it("rejects correction of an item from another session", () => {
    const oldItem = buildSessionItem({
      extractedItem: {
        category: "observation",
        content: "The LED stays dark",
        sourceText: "The LED stays dark",
      },
      sessionId: SESSION_A,
      turnId: TURN_1,
      itemIndex: 0,
    });

    const correctingItem = buildSessionItem({
      extractedItem: {
        category: "observation",
        content: "The LED actually lights dimly",
        sourceText: "The LED actually lights dimly",
        correctionRef: "candidate-test",
      },
      resolvedSupersedesId: oldItem.id,
      sessionId: SESSION_B,
      turnId: TURN_2,
      itemIndex: 0,
    });

    expect(() =>
      validateCorrection({
        items: [oldItem],
        newItem: correctingItem,
      })
    ).toThrow("another session");
  });

  it("rejects correcting an item that was already superseded", () => {
    const original = buildSessionItem({
      extractedItem: {
        category: "observation",
        content: "The LED stays dark",
        sourceText: "The LED stays dark",
      },
      sessionId: SESSION_A,
      turnId: TURN_1,
      itemIndex: 0,
    });

    const firstCorrection = buildSessionItem({
      extractedItem: {
        category: "observation",
        content: "The LED actually lights dimly",
        sourceText: "The LED actually lights dimly",
        correctionRef: "candidate-test",
      },
      resolvedSupersedesId: original.id,
      sessionId: SESSION_A,
      turnId: TURN_2,
      itemIndex: 0,
    });

    validateCorrection({
      items: [original],
      newItem: firstCorrection,
    });

    const secondCorrection = buildSessionItem({
      extractedItem: {
        category: "observation",
        content: "The LED blinks briefly",
        sourceText: "The LED blinks briefly",
        correctionRef: "candidate-test",
      },
      resolvedSupersedesId: original.id,
      sessionId: SESSION_A,
      turnId: "55555555-5555-4555-8555-555555555555",
      itemIndex: 0,
    });

    expect(() =>
      validateCorrection({
        items: [original, firstCorrection],
        newItem: secondCorrection,
      })
    ).toThrow("already superseded");
  });

  it("accepts sourceText that is an exact span of the user message", () => {
    const userMessage =
      "The LED stays dark and I measured 4.8 V at TP_SUPPLY.";

    expect(
      validateSourceText({
        extractedItem: {
          sourceText: "I measured 4.8 V at TP_SUPPLY",
        },
        userMessage,
      })
    ).toBe(true);
  });

  it("rejects sourceText invented or paraphrased by the model", () => {
    const userMessage =
      "The LED stays dark and I measured 4.8 V at TP_SUPPLY.";

    expect(() =>
      validateSourceText({
        extractedItem: {
          sourceText: "TP_SUPPLY was measured at exactly 4.8 volts",
        },
        userMessage,
      })
    ).toThrow("sourceText must be an exact span");
  });


  it("rejects unresolved extraction objects from becoming session items", () => {
    expect(() =>
      buildSessionItem({
        extractedItem: {
          sourceText: "I think it's around 5 volts",
          reason: "unclear whether this is a measurement or an estimate",
        },
        sessionId: SESSION_A,
        turnId: TURN_1,
        itemIndex: 0,
      })
    ).toThrow();
  });


  it("builds correction candidates from current items without exposing backend IDs", () => {
    const original = buildSessionItem({
      extractedItem: {
        category: "observation",
        content: "The LED stays dark",
        sourceText: "The LED stays dark",
      },
      sessionId: SESSION_A,
      turnId: TURN_1,
      itemIndex: 0,
    });

    const correction = buildSessionItem({
      extractedItem: {
        category: "observation",
        content: "The LED is dim",
        sourceText: "The LED is dim",
        correctionRef: "candidate-test",
      },
      resolvedSupersedesId: original.id,
      sessionId: SESSION_A,
      turnId: TURN_2,
      itemIndex: 0,
    });

    const context = buildCorrectionContext([
      original,
      correction,
    ]);

    expect(context.candidates).toHaveLength(1);
    expect(context.candidates[0].content).toBe("The LED is dim");
    expect(context.candidates[0].ref).toMatch(/^candidate-/);
    expect(context.candidates[0]).not.toHaveProperty("id");
    expect(context.candidates[0]).not.toHaveProperty("sessionId");
    expect(context.candidates[0]).not.toHaveProperty("turnId");
    expect(context.candidates[0]).not.toHaveProperty("supersedesId");
    expect(context.candidates[0]).not.toHaveProperty("sourceText");
    expect(context.targets.get(context.candidates[0].ref))
      .toBe(correction.id);
  });

  it("resolves only a provided correction candidate ref", () => {
    const item = buildSessionItem({
      extractedItem: {
        category: "observation",
        content: "The LED stays dark",
        sourceText: "The LED stays dark",
      },
      sessionId: SESSION_A,
      turnId: TURN_1,
      itemIndex: 0,
    });

    const context = buildCorrectionContext([item]);
    const ref = context.candidates[0].ref;

    expect(
      resolveCorrectionRef({
        correctionRef: ref,
        targets: context.targets,
      })
    ).toBe(item.id);

    expect(() =>
      resolveCorrectionRef({
        correctionRef: "candidate-not-provided",
        targets: context.targets,
      })
    ).toThrow("does not reference a current session item");
  });

  it("rejects correction context containing multiple sessions", () => {
    const first = buildSessionItem({
      extractedItem: {
        category: "observation",
        content: "The LED stays dark",
        sourceText: "The LED stays dark",
      },
      sessionId: SESSION_A,
      turnId: TURN_1,
      itemIndex: 0,
    });

    const second = buildSessionItem({
      extractedItem: {
        category: "observation",
        content: "The fan is stopped",
        sourceText: "The fan is stopped",
      },
      sessionId: SESSION_B,
      turnId: TURN_2,
      itemIndex: 0,
    });

    expect(() =>
      buildCorrectionContext([first, second])
    ).toThrow("multiple sessions");
  });

  it("requires model correctionRef and backend resolved ID together", () => {
    expect(() =>
      buildSessionItem({
        extractedItem: {
          category: "observation",
          content: "The LED is dim",
          sourceText: "The LED is dim",
          correctionRef: "candidate-test",
        },
        sessionId: SESSION_A,
        turnId: TURN_1,
        itemIndex: 0,
      })
    ).toThrow("must be provided together");

    expect(() =>
      buildSessionItem({
        extractedItem: {
          category: "observation",
          content: "The LED is dim",
          sourceText: "The LED is dim",
        },
        resolvedSupersedesId: "66666666-6666-4666-8666-666666666666",
        sessionId: SESSION_A,
        turnId: TURN_1,
        itemIndex: 0,
      })
    ).toThrow("must be provided together");
  });

});
