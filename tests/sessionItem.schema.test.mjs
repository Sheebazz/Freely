import { describe, it, expect } from "vitest";

import extractionSchemas from "../src/models/extraction.schema.js";
import sessionSchemas from "../src/models/sessionItem.schema.js";

const { extractionResponseSchema } = extractionSchemas;
const { sessionItemSchema } = sessionSchemas;

const ITEM_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TURN_ID = "33333333-3333-4333-8333-333333333333";
const OLD_ITEM_ID = "44444444-4444-4444-8444-444444444444";

describe("model extraction contract", () => {
  it("accepts a reported symptom as an observation", () => {
    const result = extractionResponseSchema.safeParse({
      items: [
        {
          category: "observation",
          content: "The LED stays dark when power is applied",
          sourceText: "The LED stays dark when power is applied",
        },
      ],
      unresolved: [],
    });

    expect(result.success).toBe(true);
  });

  it("accepts both measurements and non-numeric test results as evidence", () => {
    const result = extractionResponseSchema.safeParse({
      items: [
        {
          category: "evidence",
          kind: "measurement",
          subject: "TP_SUPPLY",
          value: 4.8,
          unit: "V",
          content: "TP_SUPPLY measured 4.8 V",
          sourceText: "TP_SUPPLY measured 4.8 V",
        },
        {
          category: "evidence",
          kind: "test_result",
          test: "continuity between TP1 and TP2",
          result: "open",
          content: "Continuity between TP1 and TP2 tested open",
          sourceText: "Continuity between TP1 and TP2 tested open",
        },
      ],
      unresolved: [],
    });

    expect(result.success).toBe(true);
  });

  it("accepts a diagnostic guess only as a hypothesis", () => {
    const result = extractionResponseSchema.safeParse({
      items: [
        {
          category: "hypothesis",
          content: "U1 may be faulty",
          sourceText: "U1 may be faulty",
        },
      ],
      unresolved: [],
    });

    expect(result.success).toBe(true);
  });

  it("rejects categories outside the THL-001 contract", () => {
    const result = extractionResponseSchema.safeParse({
      items: [
        {
          category: "confirmed_fact",
          content: "U1 is definitely faulty",
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("does not let extraction output assign verification status", () => {
    const result = extractionResponseSchema.safeParse({
      items: [{
        category: "hypothesis",
        content: "The regulator is faulty",
        sourceText: "The regulator is faulty",
        verificationStatus: "established",
      }],
      unresolved: [],
    });

    expect(result.success).toBe(false);
  });

  it("does not allow the model to assign backend-owned fields", () => {
    const result = extractionResponseSchema.safeParse({
      items: [
        {
          category: "observation",
          content: "The LED stays dark",
          sessionId: SESSION_ID,
          turnId: TURN_ID,
          provenance: {
            actor: "user",
            method: "reported_observation",
          },
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});

describe("stored session item contract", () => {
  it("accepts backend-stamped user-reported measurement evidence", () => {
    const result = sessionItemSchema.safeParse({
      id: ITEM_ID,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      itemIndex: 0,
      createdAt: "2026-09-29T13:00:00.000Z",
      supersedesId: null,

      category: "evidence",
      kind: "measurement",
      subject: "TP_SUPPLY",
      value: 4.8,
      unit: "V",
      content: "TP_SUPPLY measured 4.8 V",
      sourceText: "TP_SUPPLY measured 4.8 V",
      verificationStatus: "established",

      provenance: {
        actor: "user",
        method: "reported_measurement",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects evidence with the wrong provenance method", () => {
    const result = sessionItemSchema.safeParse({
      id: ITEM_ID,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      itemIndex: 0,
      createdAt: "2026-09-29T13:00:00.000Z",
      supersedesId: null,

      category: "evidence",
      kind: "measurement",
      subject: "TP_SUPPLY",
      value: 4.8,
      unit: "V",
      content: "TP_SUPPLY measured 4.8 V",
      sourceText: "TP_SUPPLY measured 4.8 V",
      verificationStatus: "established",

      provenance: {
        actor: "user",
        method: "reported_claim",
      },
    });

    expect(result.success).toBe(false);
  });

  it("allows a correction to point to an earlier item", () => {
    const result = sessionItemSchema.safeParse({
      id: ITEM_ID,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      itemIndex: 0,
      createdAt: "2026-09-29T13:00:00.000Z",
      supersedesId: OLD_ITEM_ID,

      category: "evidence",
      kind: "measurement",
      subject: "TP_SUPPLY",
      value: 4.8,
      unit: "V",
      content: "Corrected TP_SUPPLY measurement is 4.8 V",
      sourceText: "actually TP_SUPPLY is 4.8 V",
      verificationStatus: "established",

      provenance: {
        actor: "user",
        method: "reported_measurement",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects stored items without backend provenance", () => {
    const result = sessionItemSchema.safeParse({
      id: ITEM_ID,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      itemIndex: 0,
      createdAt: "2026-09-29T13:00:00.000Z",
      supersedesId: null,

      category: "hypothesis",
      content: "U1 may be faulty",
      sourceText: "U1 may be faulty",
      verificationStatus: "unverified",
    });

    expect(result.success).toBe(false);
  });

  it("rejects unexpected stored-item fields instead of silently stripping them", () => {
    const result = sessionItemSchema.safeParse({
      id: ITEM_ID,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      itemIndex: 0,
      createdAt: "2026-09-29T13:00:00.000Z",
      supersedesId: null,
      category: "observation",
      content: "The LED stays dark",
      sourceText: "The LED stays dark",
      verificationStatus: "unverified",
      unexpected: "must not survive validation",
      provenance: {
        actor: "user",
        method: "reported_observation",
      },
    });

    expect(result.success).toBe(false);
  });

  it("accepts a model-generated hypothesis only as unverified", () => {
    const result = sessionItemSchema.safeParse({
      id: ITEM_ID,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      itemIndex: 0,
      createdAt: "2026-09-29T13:00:00.000Z",
      supersedesId: null,
      category: "hypothesis",
      verificationStatus: "unverified",
      content: "The regulator may be faulty",
      sourceText: "The regulator may be faulty",
      provenance: {
        actor: "model",
        method: "generated_hypothesis",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects an established hypothesis", () => {
    const result = sessionItemSchema.safeParse({
      id: ITEM_ID,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      itemIndex: 0,
      createdAt: "2026-09-29T13:00:00.000Z",
      supersedesId: null,
      category: "hypothesis",
      verificationStatus: "established",
      content: "The regulator is faulty",
      sourceText: "The regulator is faulty",
      provenance: {
        actor: "model",
        method: "generated_hypothesis",
      },
    });

    expect(result.success).toBe(false);
  });

  it("accepts a trusted circuit fact only with trusted system provenance", () => {
    const result = sessionItemSchema.safeParse({
      id: ITEM_ID,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      itemIndex: 0,
      createdAt: "2026-09-29T13:00:00.000Z",
      supersedesId: null,
      category: "evidence",
      kind: "trusted_fact",
      verificationStatus: "established",
      factType: "rating",
      subject: "R3 nominal resistance",
      value: 330,
      unit: "ohm",
      content: "R3 nominal resistance is 330 ohm",
      sourceText: "R3 nominal resistance is 330 ohm",
      provenance: {
        actor: "system",
        method: "trusted_circuit_fact",
        sourceId: "circuit-one",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects user/model provenance and invalid source IDs for trusted facts", () => {
    const base = {
      id: ITEM_ID, sessionId: SESSION_ID, turnId: TURN_ID, itemIndex: 0,
      createdAt: "2026-09-29T13:00:00.000Z", supersedesId: null,
      category: "evidence", kind: "trusted_fact", factType: "rating", verificationStatus: "established",
      subject: "R3", value: 330, unit: "ohm", content: "R3 is 330 ohm",
      sourceText: "R3 is 330 ohm",
    };
    for (const provenance of [
      { actor: "user", method: "reported_claim", sourceId: "circuit-one" },
      { actor: "model", method: "generated_hypothesis", sourceId: "circuit-one" },
      { actor: "system", method: "trusted_circuit_fact" },
      { actor: "system", method: "trusted_circuit_fact", sourceId: " \t\n" },
      { actor: "system", method: "trusted_circuit_fact", sourceId: "x".repeat(201) },
    ]) {
      expect(sessionItemSchema.safeParse({ ...base, provenance }).success).toBe(false);
    }
  });

  it("rejects model-origin measurement evidence", () => {
    expect(sessionItemSchema.safeParse({
      id: ITEM_ID, sessionId: SESSION_ID, turnId: TURN_ID, itemIndex: 0,
      createdAt: "2026-09-29T13:00:00.000Z", supersedesId: null,
      category: "evidence", kind: "measurement", verificationStatus: "established",
      subject: "TP1", value: 5, unit: "V", content: "TP1 reads 5 V",
      sourceText: "TP1 reads 5 V",
      provenance: { actor: "model", method: "generated_hypothesis" },
    }).success).toBe(false);
  });

});
