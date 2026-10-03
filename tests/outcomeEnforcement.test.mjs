import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import reasoning from "../src/services/reasoning.service.js";
import { circuit, output } from "./fixtures/reasoningCircuit.mjs";
const run = (candidate, unresolved = []) => reasoning.reasonAboutTurn({
  provider: { reason: async () => candidate }, circuit: circuit(),
  context: { items: [], unresolved }, sessionId: randomUUID(), turnId: randomUUID(), itemIndex: 0,
});
describe("enforced turn outcomes", () => {
  it.each([
    ["missing separating test", output("unsupported_claim", { testId: null })],
    ["context with test", output("context_required", { testId: "read_input" })],
    ["uncertainty with test", output("cause_unestablished", { testId: "read_input" })],
    ["test menu array", output("next_test", { testId: ["read_input", "another"] })],
    ["unknown outcome", output("diagnosis")],
    ["missing why", output("next_test", { why: " " })],
    ["prose menu", output("next_test", { message: "1. Measure supply\n2. Check reset" })],
    ["extra action field", { ...output(), tests: ["another"] }],
  ])("rejects %s before hypotheses/persistence", async (_, candidate) => {
    await expect(run(candidate)).rejects.toThrow();
  });
  it("does not let unresolved evidence move on to another test", async () => {
    await expect(run(output(), [{ sourceText: "maybe 5", reason: "not a reading" }])).rejects.toThrow("clarification");
  });
  it("preserves a clear context request with an unresolved report", async () => {
    const answer = await run(output("context_required"), [{ sourceText: "maybe 5", reason: "not a reading" }]);
    expect(answer.result.recommendation).toBeNull();
  });
});
