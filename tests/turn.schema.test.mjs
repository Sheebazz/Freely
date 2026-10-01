import { describe, it, expect } from "vitest";
import turnModule from "../src/models/turn.schema.js";

const { turnCompletionSchema, turnSchema } = turnModule;

const BASE = {
  id: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
  createdAt: "2026-09-30T10:00:00.000Z",
  updatedAt: "2026-09-30T10:00:00.000Z",
  requestHash: "a".repeat(64),
};

describe("turn schema", () => {
  it("allows processing turns only without completion metadata", () => {
    expect(
      turnSchema.parse({
        ...BASE,
        status: "processing",
        completionKind: null,
        completionPayload: null,
      }).status
    ).toBe("processing");
  });

  it("requires accepted completed turns to have no payload", () => {
    expect(
      turnSchema.parse({
        ...BASE,
        status: "completed",
        completionKind: "accepted",
        completionPayload: null,
      }).completionKind
    ).toBe("accepted");

    expect(() =>
      turnSchema.parse({
        ...BASE,
        status: "completed",
        completionKind: "accepted",
        completionPayload: { reason: "unexpected" },
      })
    ).toThrow();
  });

  it("requires clarification metadata for clarification completion", () => {
    const completion = turnCompletionSchema.parse({
      kind: "clarification_required",
      payload: {
        reason: "semantic_ambiguity",
        unresolved: [
          {
            sourceText: "I think it's around 5 volts",
            reason: "unclear whether this is a reading or an estimate",
          },
        ],
      },
    });

    expect(completion.kind).toBe("clarification_required");

    expect(() =>
      turnSchema.parse({
        ...BASE,
        status: "completed",
        completionKind: "clarification_required",
        completionPayload: null,
      })
    ).toThrow();
  });

  it("keeps failed turns free of completion metadata", () => {
    expect(
      turnSchema.parse({
        ...BASE,
        status: "failed",
        completionKind: null,
        completionPayload: null,
      }).status
    ).toBe("failed");
  });
  it("rejects malformed request fingerprints", () => {
    expect(() =>
      turnSchema.parse({
        ...BASE,
        requestHash: "not-a-sha256",
        status: "processing",
        completionKind: null,
        completionPayload: null,
      })
    ).toThrow();
  });

});
