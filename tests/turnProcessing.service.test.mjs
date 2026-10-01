import { describe, it, expect, vi } from "vitest";
import turnProcessingModule from "../src/services/turnProcessing.service.js";
import sessionService from "../src/services/session.service.js";

const { fingerprintTurnRequest, processUserTurn } = turnProcessingModule;
const { buildSessionItem } = sessionService;

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const TURN_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_TURN_ID = "33333333-3333-4333-8333-333333333333";

function turn({
  requestHash,
  status = "processing",
  completionKind = null,
  completionPayload = null,
  id = TURN_ID,
} = {}) {
  return {
    id,
    sessionId: SESSION_ID,
    status,
    completionKind,
    completionPayload,
    requestHash,
    createdAt: "2026-09-30T10:00:00.000Z",
    updatedAt: "2026-09-30T10:00:00.000Z",
  };
}

function repository(overrides = {}) {
  return {
    createTurn: vi.fn(),
    finalizeTurn: vi.fn(),
    getItemsForSession: vi.fn().mockResolvedValue([]),
    getItemsForTurn: vi.fn().mockResolvedValue([]),
    getTurn: vi.fn(),
    markTurnFailed: vi.fn(),
    retryFailedTurn: vi.fn(),
    ...overrides,
  };
}

function providerWith(output) {
  return {
    extract: vi.fn().mockResolvedValue(output),
    repair: vi.fn(),
  };
}

function acceptedTurn(requestHash, id = TURN_ID) {
  return turn({
    requestHash,
    status: "completed",
    completionKind: "accepted",
    completionPayload: null,
    id,
  });
}

describe("turn processing service", () => {
  it("fingerprints the exact message plus normalized turn context", () => {
    const first = fingerprintTurnRequest({
      userMessage: "It reads 4.8 volts.",
      turnContext: {
        requestedSubject: "TP1 voltage relative to ground",
        expectedResponseType: "measurement",
      },
    });

    const same = fingerprintTurnRequest({
      userMessage: "It reads 4.8 volts.",
      turnContext: {
        expectedResponseType: "measurement",
        requestedSubject: "TP1 voltage relative to ground",
      },
    });

    const different = fingerprintTurnRequest({
      userMessage: "It reads 4.9 volts.",
      turnContext: {
        expectedResponseType: "measurement",
        requestedSubject: "TP1 voltage relative to ground",
      },
    });

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(same).toBe(first);
    expect(different).not.toBe(first);
  });

  it("processes a new turn through extraction and atomic finalization", async () => {
    const userMessage = "The LED stays dark.";
    const requestHash = fingerprintTurnRequest({ userMessage });
    const processingTurn = turn({ requestHash });
    const completedTurn = acceptedTurn(requestHash);
    const repo = repository({
      getTurn: vi.fn().mockResolvedValue(null),
      createTurn: vi.fn().mockResolvedValue(processingTurn),
      finalizeTurn: vi.fn().mockResolvedValue(completedTurn),
    });
    const provider = providerWith({
      items: [
        {
          category: "observation",
          content: "The LED stays dark",
          sourceText: "The LED stays dark",
        },
      ],
      unresolved: [],
    });

    const result = await processUserTurn({
      repository: repo,
      provider,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      userMessage,
    });

    expect(result.status).toBe("completed");
    expect(result.replayed).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].category).toBe("observation");
    expect(result.items[0].provenance.method).toBe("reported_observation");
    expect(repo.createTurn).toHaveBeenCalledWith({
      id: TURN_ID,
      sessionId: SESSION_ID,
      requestHash,
    });
    expect(repo.finalizeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        id: TURN_ID,
        sessionId: SESSION_ID,
        completion: { kind: "accepted", payload: null },
      })
    );
  });

  it("resolves an explicit correction through the temporary candidate ref", async () => {
    const userMessage = "Actually TP1 reads 4.8 V.";
    const requestHash = fingerprintTurnRequest({ userMessage });
    const oldItem = buildSessionItem({
      extractedItem: {
        category: "evidence",
        kind: "measurement",
        subject: "TP1",
        value: 5.02,
        unit: "V",
        content: "TP1 measured 5.02 V",
        sourceText: "TP1 measured 5.02 V",
      },
      sessionId: SESSION_ID,
      turnId: OTHER_TURN_ID,
      itemIndex: 0,
    });
    const repo = repository({
      getTurn: vi.fn().mockResolvedValue(null),
      createTurn: vi.fn().mockResolvedValue(turn({ requestHash })),
      getItemsForSession: vi.fn().mockResolvedValue([oldItem]),
      finalizeTurn: vi.fn().mockImplementation(async ({ completion }) =>
        turn({
          requestHash,
          status: "completed",
          completionKind: completion.kind,
          completionPayload: completion.payload,
        })
      ),
    });
    const provider = {
      extract: vi.fn().mockImplementation(async ({ correctionCandidates }) => ({
        items: [
          {
            category: "evidence",
            kind: "measurement",
            subject: "TP1",
            value: 4.8,
            unit: "V",
            content: "TP1 measured 4.8 V",
            sourceText: "TP1 reads 4.8 V",
            correctionRef: correctionCandidates[0].ref,
          },
        ],
        unresolved: [],
      })),
      repair: vi.fn(),
    };

    const result = await processUserTurn({
      repository: repo,
      provider,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      userMessage,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].supersedesId).toBe(oldItem.id);
    expect(result.items[0].value).toBe(4.8);
  });

  it("persists classified items while completing with semantic ambiguity", async () => {
    const userMessage = "The LED stays dark, maybe around 330.";
    const requestHash = fingerprintTurnRequest({ userMessage });
    const repo = repository({
      getTurn: vi.fn().mockResolvedValue(null),
      createTurn: vi.fn().mockResolvedValue(turn({ requestHash })),
      finalizeTurn: vi.fn().mockImplementation(async ({ completion }) =>
        turn({
          requestHash,
          status: "completed",
          completionKind: completion.kind,
          completionPayload: completion.payload,
        })
      ),
    });
    const provider = providerWith({
      items: [
        {
          category: "observation",
          content: "The LED stays dark",
          sourceText: "The LED stays dark",
        },
      ],
      unresolved: [
        {
          sourceText: "maybe around 330",
          reason: "unclear whether this is a reading, marking, or estimate",
        },
      ],
    });

    const result = await processUserTurn({
      repository: repo,
      provider,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      userMessage,
    });

    expect(result.items).toHaveLength(1);
    expect(result.completion.kind).toBe("clarification_required");
    expect(result.completion.payload.reason).toBe("semantic_ambiguity");
    expect(result.completion.payload.unresolved).toHaveLength(1);
  });

  it("stores unrecoverable extraction as a replayable clarification outcome", async () => {
    const userMessage = "The LED stays dark.";
    const requestHash = fingerprintTurnRequest({ userMessage });
    const repo = repository({
      getTurn: vi.fn().mockResolvedValue(null),
      createTurn: vi.fn().mockResolvedValue(turn({ requestHash })),
      finalizeTurn: vi.fn().mockImplementation(async ({ completion }) =>
        turn({
          requestHash,
          status: "completed",
          completionKind: completion.kind,
          completionPayload: completion.payload,
        })
      ),
    });
    const provider = {
      extract: vi.fn().mockResolvedValue({
        items: [
          {
            category: "observation",
            content: "The LED stays dark",
            sourceText: "not in the message",
          },
        ],
        unresolved: [],
      }),
      repair: vi.fn().mockResolvedValue({
        items: [
          {
            category: "observation",
            content: "The LED stays dark",
            sourceText: "still not in the message",
          },
        ],
        unresolved: [],
      }),
    };

    const result = await processUserTurn({
      repository: repo,
      provider,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      userMessage,
    });

    expect(result.items).toHaveLength(0);
    expect(result.completion.kind).toBe("clarification_required");
    expect(result.completion.payload.reason).toBe("extraction_unrecoverable");
    expect(result.completion.payload.detail).toBeTruthy();
    expect(provider.repair).toHaveBeenCalledOnce();
  });

  it("replays a completed turn without calling the model again", async () => {
    const userMessage = "The LED stays dark.";
    const requestHash = fingerprintTurnRequest({ userMessage });
    const completedTurn = acceptedTurn(requestHash);
    const storedItem = buildSessionItem({
      extractedItem: {
        category: "observation",
        content: "The LED stays dark",
        sourceText: "The LED stays dark",
      },
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      itemIndex: 0,
    });
    const repo = repository({
      getTurn: vi.fn().mockResolvedValue(completedTurn),
      getItemsForTurn: vi.fn().mockResolvedValue([storedItem]),
    });
    const provider = providerWith({ items: [], unresolved: [] });

    const result = await processUserTurn({
      repository: repo,
      provider,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      userMessage,
    });

    expect(result.replayed).toBe(true);
    expect(result.items).toEqual([storedItem]);
    expect(provider.extract).not.toHaveBeenCalled();
    expect(repo.createTurn).not.toHaveBeenCalled();
    expect(repo.finalizeTurn).not.toHaveBeenCalled();
  });

  it("handles a simultaneous create race without starting duplicate model work", async () => {
    const userMessage = "The LED stays dark.";
    const requestHash = fingerprintTurnRequest({ userMessage });
    const processingTurn = turn({ requestHash });
    const repo = repository({
      getTurn: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(processingTurn),
      createTurn: vi.fn().mockRejectedValue(new Error("duplicate key")),
    });
    const provider = providerWith({ items: [], unresolved: [] });

    const result = await processUserTurn({
      repository: repo,
      provider,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      userMessage,
    });

    expect(result).toEqual({
      status: "processing",
      reason: "turn_already_processing",
    });
    expect(provider.extract).not.toHaveBeenCalled();
  });

  it("does not call the model for a duplicate turn that is still processing", async () => {
    const userMessage = "The LED stays dark.";
    const requestHash = fingerprintTurnRequest({ userMessage });
    const repo = repository({
      getTurn: vi.fn().mockResolvedValue(turn({ requestHash })),
    });
    const provider = providerWith({ items: [], unresolved: [] });

    const result = await processUserTurn({
      repository: repo,
      provider,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      userMessage,
    });

    expect(result).toEqual({
      status: "processing",
      reason: "turn_already_processing",
    });
    expect(provider.extract).not.toHaveBeenCalled();
  });

  it("retries a failed turn once and then processes it normally", async () => {
    const userMessage = "The LED stays dark.";
    const requestHash = fingerprintTurnRequest({ userMessage });
    const failedTurn = turn({ requestHash, status: "failed" });
    const processingTurn = turn({ requestHash });
    const repo = repository({
      getTurn: vi.fn().mockResolvedValue(failedTurn),
      retryFailedTurn: vi.fn().mockResolvedValue(processingTurn),
      finalizeTurn: vi.fn().mockResolvedValue(acceptedTurn(requestHash)),
    });
    const provider = providerWith({
      items: [
        {
          category: "observation",
          content: "The LED stays dark",
          sourceText: "The LED stays dark",
        },
      ],
      unresolved: [],
    });

    const result = await processUserTurn({
      repository: repo,
      provider,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      userMessage,
    });

    expect(result.status).toBe("completed");
    expect(repo.retryFailedTurn).toHaveBeenCalledOnce();
    expect(provider.extract).toHaveBeenCalledOnce();
  });

  it("marks the turn failed when provider processing fails", async () => {
    const userMessage = "The LED stays dark.";
    const requestHash = fingerprintTurnRequest({ userMessage });
    const processingTurn = turn({ requestHash });
    const repo = repository({
      getTurn: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(processingTurn),
      createTurn: vi.fn().mockResolvedValue(processingTurn),
      markTurnFailed: vi.fn().mockResolvedValue(
        turn({ requestHash, status: "failed" })
      ),
    });
    const providerError = new Error("provider unavailable");
    const provider = {
      extract: vi.fn().mockRejectedValue(providerError),
      repair: vi.fn(),
    };

    await expect(
      processUserTurn({
        repository: repo,
        provider,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
        userMessage,
      })
    ).rejects.toThrow("provider unavailable");

    expect(repo.markTurnFailed).toHaveBeenCalledWith({
      id: TURN_ID,
      sessionId: SESSION_ID,
    });
  });

  it("replays a turn if finalization committed but the response was lost", async () => {
    const userMessage = "The LED stays dark.";
    const requestHash = fingerprintTurnRequest({ userMessage });
    const processingTurn = turn({ requestHash });
    const completedTurn = acceptedTurn(requestHash);
    const storedItem = buildSessionItem({
      extractedItem: {
        category: "observation",
        content: "The LED stays dark",
        sourceText: "The LED stays dark",
      },
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      itemIndex: 0,
    });
    const repo = repository({
      getTurn: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(completedTurn),
      createTurn: vi.fn().mockResolvedValue(processingTurn),
      finalizeTurn: vi.fn().mockRejectedValue(new Error("network timeout")),
      getItemsForTurn: vi.fn().mockResolvedValue([storedItem]),
    });
    const provider = providerWith({
      items: [
        {
          category: "observation",
          content: "The LED stays dark",
          sourceText: "The LED stays dark",
        },
      ],
      unresolved: [],
    });

    const result = await processUserTurn({
      repository: repo,
      provider,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      userMessage,
    });

    expect(result.replayed).toBe(true);
    expect(result.items).toEqual([storedItem]);
    expect(repo.markTurnFailed).not.toHaveBeenCalled();
  });

  it("rejects reusing a turn id for different request input", async () => {
    const oldHash = fingerprintTurnRequest({
      userMessage: "The LED stays dark.",
    });
    const repo = repository({
      getTurn: vi.fn().mockResolvedValue(acceptedTurn(oldHash)),
    });
    const provider = providerWith({ items: [], unresolved: [] });

    await expect(
      processUserTurn({
        repository: repo,
        provider,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
        userMessage: "The LED is bright.",
      })
    ).rejects.toThrow("different request");

    expect(provider.extract).not.toHaveBeenCalled();
  });
});
