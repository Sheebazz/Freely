import { describe, it, expect } from "vitest";

import sessionService from "../src/services/session.service.js";

const {
  buildCorrectionContext,
  buildModelHypothesis,
  buildSessionItem,
  buildTrustedCircuitFact,
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
    expect(item.verificationStatus).toBe("unverified");
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
    expect(item.verificationStatus).toBe("established");
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
    expect(item.verificationStatus).toBe("unverified");
  });

  it("records a model claim as an unverified model hypothesis even if it claims authority", () => {
    const item = buildModelHypothesis({
      modelOutput: {
        content: "The regulator is faulty",
        sourceText: "The regulator is faulty",
        verificationStatus: "established",
        category: "fact",
      },
      sessionId: SESSION_A,
      turnId: TURN_1,
      itemIndex: 0,
    });

    expect(item.category).toBe("hypothesis");
    expect(item.verificationStatus).toBe("unverified");
    expect(item.provenance).toEqual({
      actor: "model",
      method: "generated_hypothesis",
    });
  });

  it("keeps a model diagnosis unverified even when established measurement evidence exists", () => {
    const measurement = buildSessionItem({
      extractedItem: {
        category: "evidence",
        kind: "measurement",
        subject: "REG_OUT",
        value: 0,
        unit: "V",
        content: "REG_OUT measured 0 V",
        sourceText: "REG_OUT measured 0 V",
      },
      sessionId: SESSION_A,
      turnId: TURN_1,
      itemIndex: 0,
    });

    const diagnosis = buildModelHypothesis({
      modelOutput: { content: "The regulator is faulty" },
      sessionId: SESSION_A,
      turnId: TURN_1,
      itemIndex: 1,
    });

    expect(measurement.verificationStatus).toBe("established");
    expect(diagnosis.verificationStatus).toBe("unverified");
  });

  it("builds an established trusted circuit fact only from an explicit trusted source", () => {
    const item = buildTrustedCircuitFact({
      fact: {
        factType: "rating",
        subject: "R3 nominal resistance",
        value: 330,
        unit: "ohm",
        content: "R3 nominal resistance is 330 ohm",
        sourceText: "R3 nominal resistance is 330 ohm",
      },
      trustedSourceId: "circuit-one",
      sessionId: SESSION_A,
      turnId: TURN_1,
      itemIndex: 0,
    });

    expect(item.verificationStatus).toBe("established");
    expect(item.provenance).toEqual({
      actor: "system",
      method: "trusted_circuit_fact",
      sourceId: "circuit-one",
    });
  });

  it("does not offer model hypotheses or trusted facts as user correction candidates", () => {
    const userObservation = buildSessionItem({
      extractedItem: {
        category: "observation",
        content: "The LED stays dark",
        sourceText: "The LED stays dark",
      },
      sessionId: SESSION_A,
      turnId: TURN_1,
      itemIndex: 0,
    });

    const modelHypothesis = buildModelHypothesis({
      modelOutput: { content: "The regulator may be faulty" },
      sessionId: SESSION_A,
      turnId: TURN_1,
      itemIndex: 1,
    });

    const trustedFact = buildTrustedCircuitFact({
      fact: {
        factType: "rating",
        subject: "R3 nominal resistance",
        value: 330,
        unit: "ohm",
        content: "R3 nominal resistance is 330 ohm",
        sourceText: "R3 nominal resistance is 330 ohm",
      },
      trustedSourceId: "circuit-one",
      sessionId: SESSION_A,
      turnId: TURN_1,
      itemIndex: 2,
    });

    const { candidates } = buildCorrectionContext([
      userObservation,
      modelHypothesis,
      trustedFact,
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].category).toBe("observation");
  });

  it("does not promote a repeated unsupported claim", () => {
    const claims = [TURN_1, TURN_2].map((turnId, itemIndex) =>
      buildSessionItem({
        extractedItem: {
          category: "hypothesis",
          content: "The regulator is faulty",
          sourceText: "The regulator is faulty",
        },
        sessionId: SESSION_A,
        turnId,
        itemIndex,
      })
    );

    expect(claims.every((item) => item.verificationStatus === "unverified"))
      .toBe(true);
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

  it("rejects a correction that changes category or evidence kind", () => {
    const observation = buildSessionItem({
      extractedItem: {
        category: "observation",
        content: "The LED looks dim",
        sourceText: "The LED looks dim",
      },
      sessionId: SESSION_A,
      turnId: TURN_1,
      itemIndex: 0,
    });

    const promoted = buildSessionItem({
      extractedItem: {
        category: "hypothesis",
        content: "The LED is faulty",
        sourceText: "The LED is faulty",
        correctionRef: "candidate-test",
      },
      resolvedSupersedesId: observation.id,
      sessionId: SESSION_A,
      turnId: TURN_2,
      itemIndex: 0,
    });

    expect(() =>
      validateCorrection({
        items: [observation],
        newItem: promoted,
      })
    ).toThrow("cannot change item category");
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

  it("rejects diagnostic facts and missing metadata type at the trusted builder", () => {
    for (const factType of ["diagnosis", "causal_claim", undefined]) {
      expect(() => buildTrustedCircuitFact({
        fact: { factType, subject: "U3", value: "faulty", unit: null,
          content: "U3 is faulty", sourceText: "U3 is faulty" },
        trustedSourceId: "fixture", sessionId: SESSION_ID, turnId: TURN_ID, itemIndex: 0,
      })).toThrow();
    }
  });

});
