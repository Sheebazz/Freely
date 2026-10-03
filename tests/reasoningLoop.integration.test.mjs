import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { image } from "./fixtures/chatImage.mjs";
import repository from "../src/repositories/supabaseSession.repository.js";
import config from "../src/config/supabase.js";
import service from "../src/services/turnProcessing.service.js";
import schemas from "../src/models/reasoning.schema.js";
import sessionService from "../src/services/session.service.js";
import circuits from "../src/services/circuitContext.service.js";
import { circuit, output } from "./fixtures/reasoningCircuit.mjs";
import { reasoningEnvelopeCases } from "./fixtures/reasoningEnvelopeCases.mjs";

const { supabase } = config;
const hash = "a".repeat(64);
const board = circuit();
const result = { kind: "next_test", message: "Check the input supply.",
  why: "This separates an absent supply from a downstream problem.",
  supportingItemIds: [], recommendation: board.tests.get("read_input") };

async function withSession(work) {
  const sessionId = randomUUID();
  await repository.createSession({ id: sessionId, circuitId: "circuit-one", createdAt: new Date().toISOString() });
  try { return await work(sessionId); }
  finally {
    const { error } = await supabase.from("sessions").delete().eq("id", sessionId);
    if (error) throw new Error(`Test cleanup failed: ${error.message}`);
  }
}
async function raw(sessionId, turnId, overrides = {}) {
  return supabase.rpc("finalize_reasoning_turn", {
    p_session_id: sessionId, p_turn_id: turnId, p_items: [],
    p_completion_kind: "accepted", p_completion_payload: null,
    p_reasoning_result: result, p_expected_revision: 0,
    p_reply_to_turn_id: null, p_circuit_hash: hash, ...overrides,
  });
}
async function createTurn(sessionId) {
  const id = randomUUID(); await repository.createTurn({ id, sessionId, requestHash: hash }); return id;
}
const extractor = () => ({ extract: vi.fn(async ({ userMessage }) => ({
  items: [{ category: "observation", content: userMessage, sourceText: userMessage }], unresolved: [],
})) });

describe("THL-003 reasoning persistence", () => {
  it("creates browser sessions with a retrievable token hash and no credential in the session response", async () => {
    const id = randomUUID();
    try {
      const session = await repository.createSession({ id, circuitId: "circuit-one",
        createdAt: new Date().toISOString(), accessTokenHash: hash });
      expect(session).not.toHaveProperty("accessTokenHash");
      expect(await repository.getSessionAccessHash(id)).toBe(hash);
    } finally {
      const { error } = await supabase.from("sessions").delete().eq("id", id);
      if (error) throw new Error("Browser session cleanup failed");
    }
  }, 30000);
  it("persists user-board context and clarification without acquiring demo facts", async () => {
    const id = randomUUID(); const boardDescription = "A battery-powered power bank with unreadable markings.";
    try {
      await repository.createSession({ id, circuitId: "user-board", boardDescription,
        accessTokenHash: hash, createdAt: new Date().toISOString() });
      expect((await repository.getSession(id)).boardDescription).toBe(boardDescription);
      const reasoningProvider = { reason: vi.fn(async ({ context }) => {
        expect(context.circuit.description.summary).toBe(boardDescription);
        expect(context.circuit.available_tests.map(test => test.id)).toEqual(["read_external_label", "inspect_external_condition"]);
        return output("context_required");
      }) };
      const args = { repository, provider: extractor(), reasoningProvider, sessionId: id,
        turnId: randomUUID(), userMessage: "The LED is dark." };
      const first = await service.processUserTurn(args);
      const replay = await service.processUserTurn(args);
      expect(replay.reasoning).toEqual(first.reasoning);
      expect(reasoningProvider.reason).toHaveBeenCalledOnce();
      expect((await repository.getItemsForSession(id)).some(item => item.kind === "trusted_fact")).toBe(false);
    } finally {
      const { error } = await supabase.from("sessions").delete().eq("id", id);
      if (error) throw new Error("User board cleanup failed");
    }
  }, 30000);
  it("round-trips all three uncertainty bases through the raw finalizer", async () => {
    for (const uncertaintyBasis of ["catalogue_limit", "access_limit", "evidence_limit"]) {
      await withSession(async (sessionId) => {
        const turnId = await createTurn(sessionId);
        const answer = { ...result, kind: "cause_unestablished", recommendation: null, uncertaintyBasis };
        expect((await raw(sessionId, turnId, { p_reasoning_result: answer })).error).toBeNull();
        expect((await repository.getTurn({ id: turnId, sessionId })).reasoningResult).toEqual(answer);
      });
    }
  }, 30000);
  it("rejects a missing uncertainty basis without finalizing or advancing state", async () => withSession(async (sessionId) => {
    const turnId = await createTurn(sessionId);
    const response = await raw(sessionId, turnId, { p_reasoning_result: {
      ...result, kind: "cause_unestablished", recommendation: null,
    } });
    expect(response.error?.message).toContain("explicit uncertainty basis");
    expect((await repository.getTurn({ id: turnId, sessionId })).status).toBe("processing");
    expect((await repository.getSession(sessionId)).stateRevision).toBe(0);
  }), 30000);

  it("round-trips all four outcomes and replays without either provider", async () => withSession(async (sessionId) => {
    for (const kind of ["next_test", "context_required", "unsupported_claim", "cause_unestablished"]) {
      const turnId = randomUUID(); const provider = extractor();
      const reasoningProvider = { reason: vi.fn(async () => output(kind)) };
      const args = { repository, provider, reasoningProvider, sessionId, turnId,
        userMessage: "The LED is dark.", circuitLoader: () => board };
      const first = await service.processUserTurn(args);
      const replay = await service.processUserTurn(args);
      expect(replay.reasoning).toEqual(first.reasoning);
      expect(replay.reasoning.kind).toBe(kind);
      expect(provider.extract).toHaveBeenCalledOnce();
      expect(reasoningProvider.reason).toHaveBeenCalledOnce();
    }
  }), 60000);

  it("persists model output through the hypothesis guard despite a forged established field", async () => withSession(async (sessionId) => {
    const response = await service.processUserTurn({ repository, provider: extractor(),
      reasoningProvider: { reason: async () => output("unsupported_claim", { hypotheses: [{
        content: "U1 might be faulty", category: "evidence", verificationStatus: "established" }] }) },
      sessionId, turnId: randomUUID(), userMessage: "The LED is dark.", circuitLoader: () => board });
    const persisted = await repository.getItemsForTurn({ sessionId, turnId: response.turn.id });
    expect(persisted.at(-1)).toMatchObject({ category: "hypothesis", verificationStatus: "unverified",
      provenance: { actor: "model", method: "generated_hypothesis" } });
  }), 30000);

  it("persists contextual measurement origin and the recommendation turn binding", async () => withSession(async (sessionId) => {
    const first = await service.processUserTurn({ repository, provider: extractor(),
      reasoningProvider: { reason: async () => output() }, sessionId, turnId: randomUUID(),
      userMessage: "The LED is dark.", circuitLoader: () => board });
    const next = await service.processUserTurn({ repository,
      provider: { extract: async () => ({ items: [{ category: "evidence", kind: "measurement",
        subject: "TP_INPUT relative to GND", value: 4.8, unit: "V", content: "Input reading is 4.8 V",
        sourceText: "The meter reads 4.8 V." }], unresolved: [] }) },
      reasoningProvider: { reason: async () => output("cause_unestablished") },
      sessionId, turnId: randomUUID(), replyToTurnId: first.turn.id,
      userMessage: "The meter reads 4.8 V.", circuitLoader: () => board });
    const persisted = await repository.getItemsForTurn({ sessionId, turnId: next.turn.id });
    expect(persisted[0].measurementContext).toEqual({ subjectOrigin: "recommended_test", recommendationTurnId: first.turn.id });
    expect((await repository.getTurn({ id: next.turn.id, sessionId })).replyToTurnId).toBe(first.turn.id);
  }), 30000);

  it("retains recommendation binding through a clarification-only turn in PostgreSQL", async () => withSession(async (sessionId) => {
    const first = await createTurn(sessionId); expect((await raw(sessionId, first)).error).toBeNull();
    const clarification = await createTurn(sessionId);
    expect((await raw(sessionId, clarification, { p_expected_revision: 1, p_reply_to_turn_id: first,
      p_reasoning_result: { ...result, kind: "context_required", recommendation: null } })).error).toBeNull();
    const next = await createTurn(sessionId);
    expect((await raw(sessionId, next, { p_expected_revision: 2, p_reply_to_turn_id: first })).error).toBeNull();
    expect((await repository.getTurn({ id: next, sessionId })).replyToTurnId).toBe(first);
  }), 30000);

  it("uses the registered runtime fixture and persists its curated facts only in the owning session", async () =>
    withSession(async (firstSession) => withSession(async (secondSession) => {
      const runtimeBoard = circuits.loadCircuitContext("circuit-one");
      for (const sessionId of [firstSession, secondSession]) {
        const turn = await service.processUserTurn({ repository, provider: extractor(),
          reasoningProvider: { reason: async ({ context }) => {
            expect(context.circuit).not.toHaveProperty("fault_cases");
            expect(context.circuit).not.toHaveProperty("hidden_circuit_facts");
            return output("cause_unestablished");
          } }, sessionId, turnId: randomUUID(), userMessage: "The LED is dark." });
        const stored = await repository.getItemsForTurn({ sessionId, turnId: turn.turn.id });
        const facts = stored.filter((item) => item.kind === "trusted_fact");
        expect(facts).toHaveLength(runtimeBoard.facts.length);
        expect(facts.every((item) => item.sessionId === sessionId
          && item.provenance.sourceId === runtimeBoard.sourceId)).toBe(true);
      }
    })), 60000);

  it("rejects a stale reasoning snapshot after a legacy finalization", async () => withSession(async (sessionId) => {
    const stale = await createTurn(sessionId); const other = await createTurn(sessionId);
    await repository.finalizeTurn({ id: other, sessionId, items: [], completion: { kind: "accepted", payload: null } });
    const response = await raw(sessionId, stale);
    expect(response.error?.message).toContain("Session changed while reasoning");
    expect((await repository.getTurn({ id: stale, sessionId })).status).toBe("processing");
    expect((await repository.getSession(sessionId)).stateRevision).toBe(1);
  }), 30000);

  it("rejects a changed circuit hash without advancing state", async () => withSession(async (sessionId) => {
    const first = await createTurn(sessionId); expect((await raw(sessionId, first)).error).toBeNull();
    const next = await createTurn(sessionId);
    const response = await raw(sessionId, next, { p_expected_revision: 1, p_circuit_hash: "b".repeat(64) });
    expect(response.error?.message).toContain("Circuit context changed");
    expect((await repository.getSession(sessionId)).stateRevision).toBe(1);
  }), 30000);

  it("rejects a cross-session recommendation through raw RPC", async () => withSession(async (firstSession) =>
    withSession(async (secondSession) => {
      const first = await createTurn(firstSession); expect((await raw(firstSession, first)).error).toBeNull();
      const second = await createTurn(secondSession);
      const response = await raw(secondSession, second, { p_reply_to_turn_id: first });
      expect(response.error?.message).toContain("current recommendation");
      expect((await repository.getSession(secondSession)).stateRevision).toBe(0);
    })), 30000);

  it("rejects context subjects outside the saved recommendation and rolls back evidence", async () => withSession(async (sessionId) => {
    const first = await createTurn(sessionId); expect((await raw(sessionId, first)).error).toBeNull();
    const next = await createTurn(sessionId);
    const item = sessionService.buildSessionItem({ extractedItem: { category: "evidence", kind: "measurement",
      subject: "invented node", value: 4.8, unit: "V", content: "reading", sourceText: "The meter reads 4.8 V." },
      sessionId, turnId: next, itemIndex: 0,
      measurementContext: { subjectOrigin: "recommended_test", recommendationTurnId: first } });
    const databaseItem = {
      id: item.id, session_id: sessionId, turn_id: next, item_index: 0, category: item.category,
      kind: item.kind, subject: item.subject, value: item.value, unit: item.unit, content: item.content,
      source_text: item.sourceText, provenance: item.provenance, created_at: item.createdAt,
      measurement_context: item.measurementContext,
    };
    const response = await raw(sessionId, next, { p_expected_revision: 1, p_reply_to_turn_id: first,
      p_items: [databaseItem] });
    expect(response.error?.message).toContain("subject is not bound");
    expect(await repository.getItemsForTurn({ sessionId, turnId: next })).toHaveLength(0);
    expect((await repository.getSession(sessionId)).stateRevision).toBe(1);
  }), 30000);

  it("rejects a cross-session evidence reference", async () => withSession(async (firstSession) =>
    withSession(async (secondSession) => {
      const first = await createTurn(firstSession);
      const item = sessionService.buildModelHypothesis({ modelOutput: { content: "Possible supply fault" },
        sessionId: firstSession, turnId: first, itemIndex: 0 });
      await repository.finalizeTurn({ id: first, sessionId: firstSession, items: [item],
        completion: { kind: "accepted", payload: null } });
      const next = await createTurn(secondSession);
      const response = await raw(secondSession, next, { p_reasoning_result: { ...result, supportingItemIds: [item.id] } });
      expect(response.error?.message).toContain("cross-session");
    })), 30000);

  it("accepts only enforced outcomes that round-trip through the Node replay reader", async () => {
    for (const [label, candidate] of reasoningEnvelopeCases(result)) {
      // JSON transport drops undefined properties, exactly as the RPC does.
      const transported = JSON.parse(JSON.stringify(candidate));
      const readable = schemas.enforcedReasoningResultSchema.safeParse(transported).success;
      await withSession(async (sessionId) => {
        const turnId = await createTurn(sessionId);
        const response = await raw(sessionId, turnId, { p_reasoning_result: transported });
        expect(response.error === null, label).toBe(readable);
        const turn = await repository.getTurn({ id: turnId, sessionId });
        expect(turn.status, label).toBe(readable ? "completed" : "processing");
        if (readable) expect(turn.reasoningResult, label).toEqual(transported);
      });
    }
  }, 120000);


  it("rejects guidance over unresolved metadata before any incoming item is saved", async () => withSession(async sessionId => {
    const turnId = await createTurn(sessionId);
    const response = await raw(sessionId, turnId, { p_completion_kind: "clarification_required",
      p_completion_payload: { reason: "semantic_ambiguity", unresolved: [{ sourceText: "maybe 5", reason: "uncertain reading" }] } });
    expect(response.error?.message).toContain("Unresolved report");
    expect((await repository.getTurn({ id: turnId, sessionId })).status).toBe("processing");
    expect((await repository.getSession(sessionId)).stateRevision).toBe(0);
  }), 30000);

  it("rejects a supporting item superseded within the same batch and rolls back everything", async () => withSession(async sessionId => {
    const turnId = await createTurn(sessionId);
    const old = { id: randomUUID(), session_id: sessionId, turn_id: turnId, item_index: 0,
      category: "hypothesis", content: "Possible input fault", source_text: "Possible input fault",
      provenance: { actor: "model", method: "generated_hypothesis" }, created_at: new Date().toISOString() };
    const replacement = { ...old, id: randomUUID(), item_index: 1, supersedes_id: old.id };
    const response = await raw(sessionId, turnId, { p_items: [old, replacement],
      p_reasoning_result: { ...result, supportingItemIds: [old.id] } });
    expect(response.error?.message).toContain("superseded item");
    expect(await repository.getItemsForTurn({ sessionId, turnId })).toHaveLength(0);
    expect((await repository.getSession(sessionId)).stateRevision).toBe(0);
  }), 30000);

  it("rolls back both evidence and revision when a later item fails", async () => withSession(async (sessionId) => {
    const turnId = await createTurn(sessionId);
    const good = { id: randomUUID(), session_id: sessionId, turn_id: turnId, item_index: 0,
      category: "hypothesis", content: "Possible input fault", source_text: "Possible input fault",
      provenance: { actor: "model", method: "generated_hypothesis" }, created_at: new Date().toISOString() };
    const bad = { ...good, id: randomUUID(), item_index: 1, provenance: {} };
    const response = await raw(sessionId, turnId, { p_items: [good, bad] });
    expect(response.error).not.toBeNull();
    expect(await repository.getItemsForTurn({ sessionId, turnId })).toHaveLength(0);
    expect((await repository.getSession(sessionId)).stateRevision).toBe(0);
    expect((await repository.getTurn({ id: turnId, sessionId })).reasoningResult).toBeNull();
  }), 30000);
});

it("persists original messages and images privately and prevents cross-session or changed input writes", async () => withSession(async sessionId => {
  const provider = extractor(); const reasoningProvider = { reason: vi.fn(async () => output("context_required")) };
  const turnId = randomUUID(); const args = { repository, provider, reasoningProvider, sessionId, turnId,
    userMessage: "The label is hard to read.", images: [image], circuitLoader: () => board };
  const first = await service.processUserTurn(args);
  const inputs = await repository.getChatInputs(sessionId);
  expect(inputs).toHaveLength(1); expect(inputs[0].userMessage).toBe(args.userMessage); expect(inputs[0].images).toEqual([image]);
  await service.processUserTurn(args); expect(reasoningProvider.reason).toHaveBeenCalledOnce();
  expect(await repository.getChatInputs(randomUUID())).toEqual([]);
  const other = await repository.createTurn({ id: randomUUID(), sessionId, requestHash: hash });
  await repository.saveChatInput({ sessionId, turnId: other.id, requestHash: hash, userMessage: "Original", images: [] });
  await expect(repository.saveChatInput({ sessionId, turnId: other.id, requestHash: hash, userMessage: "Changed", images: [] })).rejects.toThrow();
  await expect(repository.saveChatInput({ sessionId: randomUUID(), turnId: other.id, requestHash: hash, userMessage: "Original", images: [] })).rejects.toThrow();
  const direct = await supabase.from("chat_inputs").insert({ session_id: sessionId, turn_id: other.id, message: "Override", images: [] });
  expect(direct.error).not.toBeNull();
}), 30000);
