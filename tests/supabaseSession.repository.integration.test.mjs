import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { clarificationCases } from "./fixtures/clarificationCases.mjs";
import turnModels from "../src/models/turn.schema.js";
import supabaseRepository from "../src/repositories/supabaseSession.repository.js";
import sessionService from "../src/services/session.service.js";
import supabaseConfig from "../src/config/supabase.js";

const {
  createSession,
  createTurn,
  finalizeTurn,
  getItemsForSession,
  getItemsForTurn,
  getSession,
  getTurn,
  markTurnFailed,
  retryFailedTurn,
} = supabaseRepository;

const { buildModelHypothesis, buildSessionItem, buildTrustedCircuitFact } = sessionService;
const { supabase } = supabaseConfig;

const acceptedCompletion = {
  kind: "accepted",
  payload: null,
};

const TEST_REQUEST_HASH = "a".repeat(64);

function createTestTurn({ id, sessionId }) {
  return createTurn({
    id,
    sessionId,
    requestHash: TEST_REQUEST_HASH,
  });
}

async function cleanupSessions(ids) {
  const { error } = await supabase
    .from("sessions")
    .delete()
    .in("id", ids);

  if (error) {
    throw new Error(`Failed to clean up test sessions: ${error.message}`);
  }
}

function observationItem({ sessionId, turnId, itemIndex = 0, content }) {
  return buildSessionItem({
    extractedItem: {
      category: "observation",
      content,
      sourceText: content,
    },
    sessionId,
    turnId,
    itemIndex,
  });
}

describe("Supabase session repository integration", () => {
  it("atomically finalizes a turn and reads typed items back", async () => {
    const sessionId = randomUUID();
    const turnId = randomUUID();
    const createdAt = new Date().toISOString();

    try {
      const session = await createSession({
        id: sessionId,
        circuitId: "circuit-one",
        createdAt,
      });

      expect(session.id).toBe(sessionId);

      await createTestTurn({ id: turnId, sessionId });

      const items = [
        observationItem({
          sessionId,
          turnId,
          itemIndex: 0,
          content: "The LED stays dark",
        }),
        buildSessionItem({
          extractedItem: {
            category: "evidence",
            kind: "measurement",
            subject: "TP1",
            value: 4.8,
            unit: "V",
            content: "TP1 measured 4.8 V",
            sourceText: "TP1 measured 4.8 V",
          },
          sessionId,
          turnId,
          itemIndex: 1,
        }),
        buildSessionItem({
          extractedItem: {
            category: "evidence",
            kind: "measurement",
            subject: "R3",
            value: "OL",
            unit: null,
            content: "R3 reads OL",
            sourceText: "R3 reads OL",
          },
          sessionId,
          turnId,
          itemIndex: 2,
        }),
      ];

      const completed = await finalizeTurn({
        id: turnId,
        sessionId,
        items,
        completion: acceptedCompletion,
      });

      expect(completed.status).toBe("completed");
      expect(completed.completionKind).toBe("accepted");
      expect(completed.completionPayload).toBeNull();
      expect(completed.requestHash).toBe(TEST_REQUEST_HASH);

      const recalled = await getItemsForTurn({ sessionId, turnId });
      expect(recalled).toHaveLength(3);
      expect(recalled[0].content).toBe("The LED stays dark");
      expect(recalled[0].verificationStatus).toBe("unverified");
      expect(recalled[1].verificationStatus).toBe("established");
      expect(recalled[1].value).toBe(4.8);
      expect(typeof recalled[1].value).toBe("number");
      expect(recalled[2].value).toBe("OL");
      expect(recalled[2].verificationStatus).toBe("established");
      expect(typeof recalled[2].value).toBe("string");

      const sessionItems = await getItemsForSession(sessionId);
      expect(sessionItems).toHaveLength(3);

      const fetchedSession = await getSession(sessionId);
      expect(fetchedSession?.id).toBe(sessionId);
    } finally {
      await cleanupSessions([sessionId]);
    }
  }, 15000);

  it("rejects direct session-item inserts outside atomic finalization", async () => {
    const sessionId = randomUUID();
    const turnId = randomUUID();
    const createdAt = new Date().toISOString();

    try {
      await createSession({ id: sessionId, circuitId: "circuit-one", createdAt });
      await createTestTurn({ id: turnId, sessionId });

      const item = observationItem({
        sessionId,
        turnId,
        content: "The LED stays dark",
      });

      const { error } = await supabase
        .from("session_items")
        .insert({
          id: item.id,
          session_id: item.sessionId,
          turn_id: item.turnId,
          item_index: item.itemIndex,
          category: item.category,
          kind: null,
          content: item.content,
          source_text: item.sourceText,
          provenance: item.provenance,
          supersedes_id: null,
          created_at: item.createdAt,
        });

      expect(error).not.toBeNull();
      expect(error?.message).toContain("permission denied");
      expect(await getItemsForTurn({ sessionId, turnId })).toHaveLength(0);
    } finally {
      await cleanupSessions([sessionId]);
    }
  }, 15000);

  it("rejects direct turn inserts, updates, and deletes outside lifecycle functions", async () => {
    const sessionId = randomUUID();
    const turnId = randomUUID();
    const directTurnId = randomUUID();
    const createdAt = new Date().toISOString();

    try {
      await createSession({ id: sessionId, circuitId: "circuit-one", createdAt });

      const { error: insertError } = await supabase
        .from("turns")
        .insert({
          id: directTurnId,
          session_id: sessionId,
          status: "processing",
          request_hash: TEST_REQUEST_HASH,
        });

      expect(insertError).not.toBeNull();
      expect(insertError?.message).toContain("permission denied");

      await createTestTurn({ id: turnId, sessionId });

      const { error: updateError } = await supabase
        .from("turns")
        .update({ status: "failed" })
        .eq("id", turnId)
        .eq("session_id", sessionId);

      expect(updateError).not.toBeNull();
      expect(updateError?.message).toContain("permission denied");

      const { error: deleteError } = await supabase
        .from("turns")
        .delete()
        .eq("id", turnId)
        .eq("session_id", sessionId);

      expect(deleteError).not.toBeNull();
      expect(deleteError?.message).toContain("permission denied");

      expect((await getTurn({ id: turnId, sessionId }))?.status)
        .toBe("processing");
    } finally {
      await cleanupSessions([sessionId]);
    }
  }, 15000);

  it("keeps sessions isolated even when they use the same circuit", async () => {
    const sessionA = randomUUID();
    const sessionB = randomUUID();
    const turnA = randomUUID();
    const createdAt = new Date().toISOString();

    try {
      await createSession({ id: sessionA, circuitId: "circuit-one", createdAt });
      await createSession({ id: sessionB, circuitId: "circuit-one", createdAt });
      await createTestTurn({ id: turnA, sessionId: sessionA });

      const itemA = observationItem({
        sessionId: sessionA,
        turnId: turnA,
        content: "The LED stays dark",
      });

      await finalizeTurn({
        id: turnA,
        sessionId: sessionA,
        items: [itemA],
        completion: acceptedCompletion,
      });

      expect(await getItemsForSession(sessionA)).toHaveLength(1);
      expect(await getItemsForSession(sessionB)).toHaveLength(0);
    } finally {
      await cleanupSessions([sessionA, sessionB]);
    }
  }, 15000);

  it("rejects creating a turn for a nonexistent session", async () => {
    await expect(
      createTestTurn({
        id: randomUUID(),
        sessionId: randomUUID(),
      })
    ).rejects.toThrow(/turns_session_fk|foreign key constraint/i);
  }, 15000);

  it("allows a correction chain where each turn supersedes the current item", async () => {
    const sessionId = randomUUID();
    const turn1 = randomUUID();
    const turn2 = randomUUID();
    const turn3 = randomUUID();
    const createdAt = new Date().toISOString();

    try {
      await createSession({ id: sessionId, circuitId: "circuit-one", createdAt });
      await createTestTurn({ id: turn1, sessionId });
      await createTestTurn({ id: turn2, sessionId });
      await createTestTurn({ id: turn3, sessionId });

      const original = buildSessionItem({
        extractedItem: {
          category: "evidence",
          kind: "measurement",
          subject: "TP1",
          value: 5.02,
          unit: "V",
          content: "TP1 measured 5.02 V",
          sourceText: "TP1 measured 5.02 V",
        },
        sessionId,
        turnId: turn1,
        itemIndex: 0,
      });

      await finalizeTurn({
        id: turn1,
        sessionId,
        items: [original],
        completion: acceptedCompletion,
      });

      const firstCorrection = buildSessionItem({
        extractedItem: {
          category: "evidence",
          kind: "measurement",
          subject: "TP1",
          value: 4.8,
          unit: "V",
          content: "TP1 corrected to 4.8 V",
          sourceText: "TP1 corrected to 4.8 V",
          correctionRef: "candidate-integration",
        },
        resolvedSupersedesId: original.id,
        sessionId,
        turnId: turn2,
        itemIndex: 0,
      });

      await finalizeTurn({
        id: turn2,
        sessionId,
        items: [firstCorrection],
        completion: acceptedCompletion,
      });

      const secondCorrection = buildSessionItem({
        extractedItem: {
          category: "evidence",
          kind: "measurement",
          subject: "TP1",
          value: 4.65,
          unit: "V",
          content: "TP1 corrected again to 4.65 V",
          sourceText: "TP1 corrected again to 4.65 V",
          correctionRef: "candidate-integration",
        },
        resolvedSupersedesId: firstCorrection.id,
        sessionId,
        turnId: turn3,
        itemIndex: 0,
      });

      await finalizeTurn({
        id: turn3,
        sessionId,
        items: [secondCorrection],
        completion: acceptedCompletion,
      });

      const recalled = await getItemsForSession(sessionId);
      expect(recalled.map((item) => item.value)).toEqual([5.02, 4.8, 4.65]);
    } finally {
      await cleanupSessions([sessionId]);
    }
  }, 15000);

  it("rejects a correction fork atomically", async () => {
    const sessionId = randomUUID();
    const originalTurn = randomUUID();
    const correctionTurn = randomUUID();
    const forkTurn = randomUUID();
    const createdAt = new Date().toISOString();

    try {
      await createSession({ id: sessionId, circuitId: "circuit-one", createdAt });
      await createTestTurn({ id: originalTurn, sessionId });
      await createTestTurn({ id: correctionTurn, sessionId });
      await createTestTurn({ id: forkTurn, sessionId });

      const original = observationItem({
        sessionId,
        turnId: originalTurn,
        content: "The LED stays dark",
      });

      await finalizeTurn({
        id: originalTurn,
        sessionId,
        items: [original],
        completion: acceptedCompletion,
      });

      const correction = buildSessionItem({
        extractedItem: {
          category: "observation",
          content: "The LED is dim",
          sourceText: "The LED is dim",
          correctionRef: "candidate-integration",
        },
        resolvedSupersedesId: original.id,
        sessionId,
        turnId: correctionTurn,
        itemIndex: 0,
      });

      await finalizeTurn({
        id: correctionTurn,
        sessionId,
        items: [correction],
        completion: acceptedCompletion,
      });

      const fork = buildSessionItem({
        extractedItem: {
          category: "observation",
          content: "The LED is bright",
          sourceText: "The LED is bright",
          correctionRef: "candidate-integration",
        },
        resolvedSupersedesId: original.id,
        sessionId,
        turnId: forkTurn,
        itemIndex: 0,
      });

      await expect(
        finalizeTurn({
          id: forkTurn,
          sessionId,
          items: [fork],
          completion: acceptedCompletion,
        })
      ).rejects.toThrow("already superseded");

      expect(await getItemsForTurn({ sessionId, turnId: forkTurn })).toHaveLength(0);
      expect((await getTurn({ id: forkTurn, sessionId }))?.status).toBe("processing");
    } finally {
      await cleanupSessions([sessionId]);
    }
  }, 15000);

  it("rejects a correction that targets another session", async () => {
    const sessionA = randomUUID();
    const sessionB = randomUUID();
    const turnA = randomUUID();
    const turnB = randomUUID();
    const createdAt = new Date().toISOString();

    try {
      await createSession({ id: sessionA, circuitId: "circuit-one", createdAt });
      await createSession({ id: sessionB, circuitId: "circuit-one", createdAt });
      await createTestTurn({ id: turnA, sessionId: sessionA });
      await createTestTurn({ id: turnB, sessionId: sessionB });

      const original = observationItem({
        sessionId: sessionA,
        turnId: turnA,
        content: "The LED stays dark",
      });

      await finalizeTurn({
        id: turnA,
        sessionId: sessionA,
        items: [original],
        completion: acceptedCompletion,
      });

      const invalidCorrection = buildSessionItem({
        extractedItem: {
          category: "observation",
          content: "The LED is dim",
          sourceText: "The LED is dim",
          correctionRef: "candidate-integration",
        },
        resolvedSupersedesId: original.id,
        sessionId: sessionB,
        turnId: turnB,
        itemIndex: 0,
      });

      await expect(
        finalizeTurn({
          id: turnB,
          sessionId: sessionB,
          items: [invalidCorrection],
          completion: acceptedCompletion,
        })
      ).rejects.toThrow("another session");

      expect(await getItemsForTurn({ sessionId: sessionB, turnId: turnB })).toHaveLength(0);
    } finally {
      await cleanupSessions([sessionA, sessionB]);
    }
  }, 15000);

  it("rejects category-changing corrections at the database boundary", async () => {
    const sessionId = randomUUID();
    const originalTurn = randomUUID();
    const correctionTurn = randomUUID();
    const createdAt = new Date().toISOString();

    try {
      await createSession({ id: sessionId, circuitId: "circuit-one", createdAt });
      await createTestTurn({ id: originalTurn, sessionId });
      await createTestTurn({ id: correctionTurn, sessionId });

      const original = observationItem({
        sessionId,
        turnId: originalTurn,
        content: "The LED looks dim",
      });

      await finalizeTurn({
        id: originalTurn,
        sessionId,
        items: [original],
        completion: acceptedCompletion,
      });

      const invalidCorrection = buildSessionItem({
        extractedItem: {
          category: "hypothesis",
          content: "The LED is faulty",
          sourceText: "The LED is faulty",
          correctionRef: "candidate-integration",
        },
        resolvedSupersedesId: original.id,
        sessionId,
        turnId: correctionTurn,
        itemIndex: 0,
      });

      await expect(
        finalizeTurn({
          id: correctionTurn,
          sessionId,
          items: [invalidCorrection],
          completion: acceptedCompletion,
        })
      ).rejects.toThrow("cannot change item category");

      expect(await getItemsForTurn({ sessionId, turnId: correctionTurn }))
        .toHaveLength(0);
      expect((await getTurn({ id: correctionTurn, sessionId }))?.status)
        .toBe("processing");
    } finally {
      await cleanupSessions([sessionId]);
    }
  }, 15000);

  it("stores clarification metadata for deterministic replay", async () => {
    const sessionId = randomUUID();
    const turnId = randomUUID();
    const createdAt = new Date().toISOString();

    try {
      await createSession({ id: sessionId, circuitId: "circuit-one", createdAt });
      await createTestTurn({ id: turnId, sessionId });

      const completion = {
        kind: "clarification_required",
        payload: {
          reason: "semantic_ambiguity",
          unresolved: [
            {
              sourceText: "I think it's around 5 volts",
              reason: "unclear whether this is a meter reading or an estimate",
            },
          ],
        },
      };

      const completed = await finalizeTurn({
        id: turnId,
        sessionId,
        items: [],
        completion,
      });

      expect(completed.status).toBe("completed");
      expect(completed.completionKind).toBe("clarification_required");
      expect(completed.completionPayload).toEqual(completion.payload);
      expect(await getItemsForTurn({ sessionId, turnId })).toHaveLength(0);
    } finally {
      await cleanupSessions([sessionId]);
    }
  }, 15000);

  it("rolls back every item if atomic finalization fails", async () => {
    const sessionId = randomUUID();
    const turnId = randomUUID();
    const createdAt = new Date().toISOString();

    try {
      await createSession({ id: sessionId, circuitId: "circuit-one", createdAt });
      await createTestTurn({ id: turnId, sessionId });

      const first = observationItem({
        sessionId,
        turnId,
        itemIndex: 0,
        content: "The LED stays dark",
      });

      const second = observationItem({
        sessionId,
        turnId,
        itemIndex: 0,
        content: "The fan stays stopped",
      });

      await expect(
        finalizeTurn({
          id: turnId,
          sessionId,
          items: [first, second],
          completion: acceptedCompletion,
        })
      ).rejects.toThrow("Failed to finalize turn");

      expect(await getItemsForTurn({ sessionId, turnId })).toHaveLength(0);

      const turn = await getTurn({ id: turnId, sessionId });
      expect(turn?.status).toBe("processing");
      expect(turn?.completionKind).toBeNull();
    } finally {
      await cleanupSessions([sessionId]);
    }
  }, 15000);

  it("allows a failed turn to return to processing for a controlled retry", async () => {
    const sessionId = randomUUID();
    const turnId = randomUUID();
    const createdAt = new Date().toISOString();

    try {
      await createSession({ id: sessionId, circuitId: "circuit-one", createdAt });
      await createTestTurn({ id: turnId, sessionId });

      const failed = await markTurnFailed({ id: turnId, sessionId });
      expect(failed.status).toBe("failed");
      expect(failed.completionKind).toBeNull();

      const retried = await retryFailedTurn({ id: turnId, sessionId });
      expect(retried.status).toBe("processing");
      expect(retried.completionKind).toBeNull();
    } finally {
      await cleanupSessions([sessionId]);
    }
  }, 15000);

  it("rejects finalizing an already completed turn", async () => {
    const sessionId = randomUUID();
    const turnId = randomUUID();
    const createdAt = new Date().toISOString();

    try {
      await createSession({ id: sessionId, circuitId: "circuit-one", createdAt });
      await createTestTurn({ id: turnId, sessionId });

      await finalizeTurn({
        id: turnId,
        sessionId,
        items: [],
        completion: acceptedCompletion,
      });

      await expect(
        finalizeTurn({
          id: turnId,
          sessionId,
          items: [],
          completion: acceptedCompletion,
        })
      ).rejects.toThrow("processing status");
    } finally {
      await cleanupSessions([sessionId]);
    }
  }, 15000);

  it("rejects creating the same turn twice in one session", async () => {
    const sessionId = randomUUID();
    const turnId = randomUUID();
    const createdAt = new Date().toISOString();

    try {
      await createSession({ id: sessionId, circuitId: "circuit-one", createdAt });
      await createTestTurn({ id: turnId, sessionId });

      await expect(
        createTestTurn({ id: turnId, sessionId })
      ).rejects.toThrow(/turns_pkey|duplicate key/i);
    } finally {
      await cleanupSessions([sessionId]);
    }
  }, 15000);

  it("derives an unverified status for a model hypothesis even if the payload claims established", async () => {
    const sessionId = randomUUID();
    const turnId = randomUUID();
    const createdAt = new Date().toISOString();

    try {
      await createSession({ id: sessionId, circuitId: "circuit-one", createdAt });
      await createTestTurn({ id: turnId, sessionId });

      const modelHypothesis = buildModelHypothesis({
        modelOutput: {
          content: "The regulator is faulty",
          verificationStatus: "established",
        },
        sessionId,
        turnId,
        itemIndex: 0,
      });

      await finalizeTurn({
        id: turnId,
        sessionId,
        items: [modelHypothesis],
        completion: acceptedCompletion,
      });

      const [stored] = await getItemsForTurn({ sessionId, turnId });
      expect(stored.category).toBe("hypothesis");
      expect(stored.provenance.actor).toBe("model");
      expect(stored.verificationStatus).toBe("unverified");
    } finally {
      await cleanupSessions([sessionId]);
    }
  }, 15000);

  it("persists an explicitly trusted circuit fact as established", async () => {
    const sessionId = randomUUID();
    const turnId = randomUUID();
    const createdAt = new Date().toISOString();

    try {
      await createSession({ id: sessionId, circuitId: "circuit-one", createdAt });
      await createTestTurn({ id: turnId, sessionId });

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
        sessionId,
        turnId,
        itemIndex: 0,
      });

      await finalizeTurn({
        id: turnId,
        sessionId,
        items: [trustedFact],
        completion: acceptedCompletion,
      });

      const [stored] = await getItemsForTurn({ sessionId, turnId });
      expect(stored.kind).toBe("trusted_fact");
      expect(stored.provenance).toEqual({
        actor: "system",
        method: "trusted_circuit_fact",
        sourceId: "circuit-one",
      });
      expect(stored.verificationStatus).toBe("established");
    } finally {
      await cleanupSessions([sessionId]);
    }
  }, 15000);

  it("rejects model-authored evidence at the database persistence boundary", async () => {
    const sessionId = randomUUID();
    const turnId = randomUUID();
    const createdAt = new Date().toISOString();

    try {
      await createSession({ id: sessionId, circuitId: "circuit-one", createdAt });
      await createTestTurn({ id: turnId, sessionId });

      const { error } = await supabase.rpc("finalize_turn", {
        p_session_id: sessionId,
        p_turn_id: turnId,
        p_items: [{
          id: randomUUID(),
          session_id: sessionId,
          turn_id: turnId,
          item_index: 0,
          category: "evidence",
          kind: "measurement",
          content: "TP1 measured 5 V",
          source_text: "TP1 measured 5 V",
          subject: "TP1",
          value: 5,
          unit: "V",
          test: null,
          result: null,
          provenance: {
            actor: "model",
            method: "generated_hypothesis",
          },
          supersedes_id: null,
          created_at: new Date().toISOString(),
        }],
        p_completion_kind: "accepted",
        p_completion_payload: null,
      });

      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/provenance|constraint/i);
      expect(await getItemsForTurn({ sessionId, turnId })).toHaveLength(0);
      expect((await getTurn({ id: turnId, sessionId }))?.status).toBe("processing");
    } finally {
      await cleanupSessions([sessionId]);
    }
  }, 15000);

  it.each([
    ["missing provenance method", { provenance: { actor: "user" } }],
    ["empty provenance", { provenance: {} }],
    ["extra provenance authority field", {
      provenance: { actor: "user", method: "reported_measurement", established: true },
    }],
    ["missing evidence kind", { kind: null }],
    ["diagnostic trusted fact type", { kind: "trusted_fact", fact_type: "diagnosis",
      provenance: { actor: "system", method: "trusted_circuit_fact", sourceId: "fixture" } }],
    ["missing measurement value", { value: null }],
    ["boolean measurement value", { value: true }],
    ["untrusted circuit fact", { kind: "trusted_fact", fact_type: "rating",
      provenance: { actor: "user", method: "reported_claim", sourceId: "circuit-one" } }],
    ["trusted fact without source ID", { kind: "trusted_fact", fact_type: "rating",
      provenance: { actor: "system", method: "trusted_circuit_fact" } }],
    ["trusted fact with whitespace source ID", { kind: "trusted_fact", fact_type: "rating",
      provenance: { actor: "system", method: "trusted_circuit_fact", sourceId: " \t\n" } }],
    ["trusted fact with non-breaking-space source ID", { kind: "trusted_fact", fact_type: "rating",
      provenance: { actor: "system", method: "trusted_circuit_fact", sourceId: "\u00a0" } }],
    ["trusted fact with ideographic-space source ID", { kind: "trusted_fact", fact_type: "rating",
      provenance: { actor: "system", method: "trusted_circuit_fact", sourceId: "\u3000" } }],
    ["trusted fact with BOM-space source ID", { kind: "trusted_fact", fact_type: "rating",
      provenance: { actor: "system", method: "trusted_circuit_fact", sourceId: "\uFEFF" } }],
    ["trusted fact with numeric source ID", { kind: "trusted_fact", fact_type: "rating",
      provenance: { actor: "system", method: "trusted_circuit_fact", sourceId: 7 } }],
    ["trusted fact with oversized source ID", { kind: "trusted_fact", fact_type: "rating",
      provenance: { actor: "system", method: "trusted_circuit_fact", sourceId: "x".repeat(201) } }],
  ])("rejects %s through raw RPC and rolls back the whole turn", async (_name, overrides) => {
    const sessionId = randomUUID();
    const turnId = randomUUID();
    const createdAt = new Date().toISOString();
    try {
      await createSession({ id: sessionId, circuitId: "circuit-one", createdAt });
      await createTestTurn({ id: turnId, sessionId });
      const valid = {
        id: randomUUID(), session_id: sessionId, turn_id: turnId, item_index: 0,
        category: "evidence", kind: "measurement", content: "TP1 measured 5 V",
        source_text: "TP1 measured 5 V", subject: "TP1", value: 5, unit: "V",
        test: null, result: null,
        provenance: { actor: "user", method: "reported_measurement" },
        supersedes_id: null, created_at: createdAt,
      };
      const { error } = await supabase.rpc("finalize_turn", {
        p_session_id: sessionId, p_turn_id: turnId,
        p_items: [valid, { ...valid, ...overrides, id: randomUUID(), item_index: 1 }],
        p_completion_kind: "accepted", p_completion_payload: null,
      });
      expect(error, _name).not.toBeNull();
      expect(error?.message).toMatch(/constraint/i);
      expect(await getItemsForTurn({ sessionId, turnId })).toHaveLength(0);
      expect((await getTurn({ id: turnId, sessionId }))?.status).toBe("processing");
    } finally {
      await cleanupSessions([sessionId]);
    }
  }, 15000);

  it("ignores a raw RPC attempt to grant a model hypothesis established status", async () => {
    const sessionId = randomUUID();
    const turnId = randomUUID();
    const createdAt = new Date().toISOString();
    try {
      await createSession({ id: sessionId, circuitId: "circuit-one", createdAt });
      await createTestTurn({ id: turnId, sessionId });
      const { error } = await supabase.rpc("finalize_turn", {
        p_session_id: sessionId, p_turn_id: turnId,
        p_items: [{
          id: randomUUID(), session_id: sessionId, turn_id: turnId, item_index: 0,
          category: "hypothesis", kind: null,
          content: "The regulator is faulty", source_text: "The regulator is faulty",
          subject: null, value: null, unit: null, test: null, result: null,
          provenance: { actor: "model", method: "generated_hypothesis" },
          verification_status: "established", supersedes_id: null, created_at: createdAt,
        }],
        p_completion_kind: "accepted", p_completion_payload: null,
      });
      expect(error).toBeNull();
      const [stored] = await getItemsForTurn({ sessionId, turnId });
      expect(stored.category).toBe("hypothesis");
      expect(stored.verificationStatus).toBe("unverified");
    } finally {
      await cleanupSessions([sessionId]);
    }
  }, 15000);

  it("keeps repeated model diagnoses unverified alongside established measurements", async () => {
    const sessionId = randomUUID();
    try {
      await createSession({ id: sessionId, circuitId: "circuit-one",
        createdAt: new Date().toISOString() });
      for (let index = 0; index < 3; index += 1) {
        const turnId = randomUUID();
        await createTestTurn({ id: turnId, sessionId });
        const measurement = buildSessionItem({
          extractedItem: { category: "evidence", kind: "measurement",
            subject: "TP1", value: 0, unit: "V", content: "TP1 measured 0 V",
            sourceText: "I measured 0 V at TP1." },
          sessionId, turnId, itemIndex: 0,
        });
        const hypothesis = buildModelHypothesis({
          modelOutput: { content: "The regulator is faulty", verificationStatus: "established" },
          sessionId, turnId, itemIndex: 1,
        });
        await finalizeTurn({ id: turnId, sessionId, items: [measurement, hypothesis],
          completion: acceptedCompletion });
      }
      const items = await getItemsForSession(sessionId);
      const hypotheses = items.filter((item) => item.category === "hypothesis");
      const measurements = items.filter((item) => item.kind === "measurement");
      expect(hypotheses).toHaveLength(3);
      expect(hypotheses.every((item) => item.verificationStatus === "unverified"
        && item.provenance.actor === "model")).toBe(true);
      expect(measurements).toHaveLength(3);
      expect(measurements.every((item) => item.verificationStatus === "established")).toBe(true);
    } finally {
      await cleanupSessions([sessionId]);
    }
  }, 30000);

  it.each([
    ["null completion kind", {}, null, /Unsupported completion kind/],
    ["missing item session ID", { session_id: null }, "accepted", /finalized session/],
    ["missing item turn ID", { turn_id: null }, "accepted", /finalized turn/],
  ])("rejects %s at the raw finalization boundary", async (_name, overrides, kind, message) => {
    const sessionId = randomUUID();
    const turnId = randomUUID();
    const createdAt = new Date().toISOString();
    try {
      await createSession({ id: sessionId, circuitId: "circuit-one", createdAt });
      await createTestTurn({ id: turnId, sessionId });
      const valid = {
        id: randomUUID(), session_id: sessionId, turn_id: turnId, item_index: 0,
        category: "hypothesis", kind: null, content: "U1 may be faulty",
        source_text: "U1 may be faulty", subject: null, value: null, unit: null,
        test: null, result: null, provenance: { actor: "user", method: "reported_claim" },
        supersedes_id: null, created_at: createdAt,
      };
      const { error } = await supabase.rpc("finalize_turn", {
        p_session_id: sessionId, p_turn_id: turnId,
        p_items: [valid, { ...valid, ...overrides, id: randomUUID(), item_index: 1 }],
        p_completion_kind: kind, p_completion_payload: null,
      });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(message);
      expect(await getItemsForTurn({ sessionId, turnId })).toHaveLength(0);
      expect((await getTurn({ id: turnId, sessionId }))?.status).toBe("processing");
    } finally {
      await cleanupSessions([sessionId]);
    }
  }, 15000);

  it("keeps the raw clarification write contract aligned with the Node reader", async () => {
    const sessionId = randomUUID();
    try {
      await createSession({ id: sessionId, circuitId: "contract-audit", createdAt: new Date().toISOString() });
      let turnId = randomUUID();
      await createTestTurn({ id: turnId, sessionId });
      for (const payload of clarificationCases) {
        const expected = turnModels.turnCompletionSchema.safeParse({ kind: "clarification_required", payload }).success;
        const { error } = await supabase.rpc("finalize_turn", {
          p_session_id: sessionId, p_turn_id: turnId, p_items: [],
          p_completion_kind: "clarification_required", p_completion_payload: payload,
        });
        expect(error === null, JSON.stringify(payload)).toBe(expected);
        const turn = await getTurn({ id: turnId, sessionId });
        expect(turn.status).toBe(expected ? "completed" : "processing");
        if (expected) {
          expect(turn.completionPayload).toEqual(payload);
          turnId = randomUUID();
          await createTestTurn({ id: turnId, sessionId });
        }
      }
    } finally { await cleanupSessions([sessionId]); }
  }, 180000);

  it("rejects malformed clarification atomically even with valid items", async () => {
    const sessionId = randomUUID(); const turnId = randomUUID();
    const createdAt = new Date().toISOString();
    try {
      await createSession({ id: sessionId, circuitId: "contract-audit", createdAt });
      await createTestTurn({ id: turnId, sessionId });
      const item = { id: randomUUID(), session_id: sessionId, turn_id: turnId, item_index: 0,
        category: "hypothesis", kind: null, content: "U1 may be faulty", source_text: "U1 may be faulty",
        provenance: { actor: "user", method: "reported_claim" }, supersedes_id: null, created_at: createdAt };
      const { error } = await supabase.rpc("finalize_turn", { p_session_id: sessionId,
        p_turn_id: turnId, p_items: [item], p_completion_kind: "clarification_required",
        p_completion_payload: { reason: "semantic_ambiguity", unresolved: [null] } });
      expect(error).not.toBeNull();
      expect(await getItemsForTurn({ sessionId, turnId })).toHaveLength(0);
      expect((await getTurn({ id: turnId, sessionId })).status).toBe("processing");
    } finally { await cleanupSessions([sessionId]); }
  }, 15000);

  it("keeps trusted circuit facts scoped to their owning session", async () => {
    const first = randomUUID(); const second = randomUUID(); const turnId = randomUUID();
    const createdAt = new Date().toISOString();
    try {
      await createSession({ id: first, circuitId: "same-circuit", createdAt });
      await createSession({ id: second, circuitId: "same-circuit", createdAt });
      await createTestTurn({ id: turnId, sessionId: first });
      const fact = buildTrustedCircuitFact({ fact: { factType: "rating", subject: "R3",
        value: 330, unit: "ohm", content: "R3 is rated 330 ohm", sourceText: "R3 is rated 330 ohm" },
        trustedSourceId: "same-fixture", sessionId: first, turnId, itemIndex: 0 });
      await finalizeTurn({ id: turnId, sessionId: first, items: [fact], completion: acceptedCompletion });
      expect(await getItemsForSession(first)).toHaveLength(1);
      expect(await getItemsForSession(second)).toHaveLength(0);
    } finally { await cleanupSessions([first, second]); }
  }, 15000);

});
