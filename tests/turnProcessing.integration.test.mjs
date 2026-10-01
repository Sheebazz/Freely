import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import supabaseRepository from "../src/repositories/supabaseSession.repository.js";
import supabaseConfig from "../src/config/supabase.js";
import turnProcessingService from "../src/services/turnProcessing.service.js";
import sessionService from "../src/services/session.service.js";

const { createSession, getItemsForSession, getTurn } = supabaseRepository;
const { supabase } = supabaseConfig;
const { processUserTurn } = turnProcessingService;
const { currentItems } = sessionService;

async function cleanupSession(sessionId) {
  const { error } = await supabase
    .from("sessions")
    .delete()
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Failed to clean up test session: ${error.message}`);
  }
}

describe("turn processing integration", () => {
  it("persists multi-turn state, resolves a correction, and replays without a second model call", async () => {
    const sessionId = randomUUID();
    const firstTurnId = randomUUID();
    const secondTurnId = randomUUID();

    try {
      await createSession({
        id: sessionId,
        circuitId: "circuit-one",
        createdAt: new Date().toISOString(),
      });

      const firstProvider = {
        extract: vi.fn().mockResolvedValue({
          items: [
            {
              category: "evidence",
              kind: "measurement",
              subject: "TP1",
              value: 5.02,
              unit: "V",
              content: "TP1 measured 5.02 V",
              sourceText: "The meter says 5.02 V at TP1",
            },
          ],
          unresolved: [],
        }),
        repair: vi.fn(),
      };

      const firstResult = await processUserTurn({
        repository: supabaseRepository,
        provider: firstProvider,
        sessionId,
        turnId: firstTurnId,
        userMessage: "The meter says 5.02 V at TP1.",
      });

      expect(firstResult.completion.kind).toBe("accepted");

      const secondProvider = {
        extract: vi.fn().mockImplementation(async ({ correctionCandidates }) => {
          expect(correctionCandidates).toHaveLength(1);
          expect(correctionCandidates[0]).toMatchObject({
            category: "evidence",
            kind: "measurement",
            subject: "TP1",
            value: 5.02,
          });

          return {
            items: [
              {
                category: "evidence",
                kind: "measurement",
                subject: "TP1",
                value: 4.8,
                unit: "V",
                content: "TP1 measured 4.8 V",
                sourceText: "Actually TP1 reads 4.8 V",
                correctionRef: correctionCandidates[0].ref,
              },
            ],
            unresolved: [],
          };
        }),
        repair: vi.fn(),
      };

      const secondMessage = "Actually TP1 reads 4.8 V.";
      const secondResult = await processUserTurn({
        repository: supabaseRepository,
        provider: secondProvider,
        sessionId,
        turnId: secondTurnId,
        userMessage: secondMessage,
      });

      expect(secondResult.items).toHaveLength(1);
      expect(secondResult.items[0].supersedesId)
        .toBe(firstResult.items[0].id);

      const history = await getItemsForSession(sessionId);
      expect(history).toHaveLength(2);

      const current = currentItems(history);
      expect(current).toHaveLength(1);
      expect(current[0].value).toBe(4.8);

      const replayProvider = {
        extract: vi.fn().mockRejectedValue(
          new Error("model must not be called during replay")
        ),
      };

      const replay = await processUserTurn({
        repository: supabaseRepository,
        provider: replayProvider,
        sessionId,
        turnId: secondTurnId,
        userMessage: secondMessage,
      });

      expect(replay.replayed).toBe(true);
      expect(replay.items).toHaveLength(1);
      expect(replay.items[0].value).toBe(4.8);
      expect(replayProvider.extract).not.toHaveBeenCalled();
    } finally {
      await cleanupSession(sessionId);
    }
  }, 30000);

  it("marks provider failure as failed and retries the same request deliberately", async () => {
    const sessionId = randomUUID();
    const turnId = randomUUID();
    const userMessage = "The LED stays dark.";

    try {
      await createSession({
        id: sessionId,
        circuitId: "circuit-one",
        createdAt: new Date().toISOString(),
      });

      const failingProvider = {
        extract: vi.fn().mockRejectedValue(new Error("provider unavailable")),
      };

      await expect(
        processUserTurn({
          repository: supabaseRepository,
          provider: failingProvider,
          sessionId,
          turnId,
          userMessage,
        })
      ).rejects.toThrow("provider unavailable");

      expect((await getTurn({ id: turnId, sessionId }))?.status)
        .toBe("failed");

      const succeedingProvider = {
        extract: vi.fn().mockResolvedValue({
          items: [
            {
              category: "observation",
              content: "The LED stays dark",
              sourceText: "The LED stays dark",
            },
          ],
          unresolved: [],
        }),
        repair: vi.fn(),
      };

      const result = await processUserTurn({
        repository: supabaseRepository,
        provider: succeedingProvider,
        sessionId,
        turnId,
        userMessage,
      });

      expect(result.status).toBe("completed");
      expect(result.replayed).toBe(false);
      expect(result.items).toHaveLength(1);
      expect((await getTurn({ id: turnId, sessionId }))?.status)
        .toBe("completed");
    } finally {
      await cleanupSession(sessionId);
    }
  }, 30000);
});
