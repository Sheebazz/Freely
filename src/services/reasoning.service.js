const { reasoningOutputSchema, enforcedReasoningResultSchema } = require("../models/reasoning.schema");
const { buildModelHypothesis } = require("./session.service");

function assertContextBudget(context) {
  // Fail visibly rather than silently dropping old evidence or letting an
  // unbounded session create an unbounded provider request.
  if (JSON.stringify({ ...context, images: (context.images || []).map(image => ({ mimeType: image.mimeType, turnId: image.turnId })) }).length > 200000) {
    throw new Error("Reasoning context exceeds this MVP's session budget");
  }
}

async function reasonAboutTurn({ provider, context, circuit, sessionId, turnId, itemIndex }) {
  if (!provider || typeof provider.reason !== "function") {
    throw new Error("A reasoning provider is required");
  }
  assertContextBudget(context);
  const output = reasoningOutputSchema.parse(await provider.reason({ context }));
  if (output.kind === "cause_unestablished" && output.uncertaintyBasis === null) {
    throw new Error("Unestablished cause requires an explicit uncertainty basis");
  }
  if (output.kind !== "cause_unestablished" && output.uncertaintyBasis !== null) {
    throw new Error("Uncertainty basis belongs only to an unestablished cause");
  }
  const requiresTest = ["next_test", "unsupported_claim"].includes(output.kind);
  if (requiresTest !== (output.testId !== null)) throw new Error("Outcome content is inconsistent");
  // Explicit menus and instruction lists are refused, not rewritten into valid guidance.
  // Prose meaning is still a semantic evaluation boundary; see the guarantee limits.
  if (/(?:^|\n)\s*(?:[-*•]|\d+[.)])\s+/m.test(output.message + "\n" + output.why)) {
    throw new Error("Guidance must not contain a list of actions");
  }
  if (context.unresolved.length && output.kind !== "context_required") {
    throw new Error("Unresolved report requires clarification before guidance");
  }
  const allowedIds = new Set(context.items.map((item) => item.id));
  for (const id of output.supportingItemIds) {
    if (!allowedIds.has(id)) throw new Error("Reasoning references an unknown or superseded item");
  }
  let recommendation = null;
  if (output.testId !== null) {
    recommendation = circuit.tests.get(output.testId);
    if (!recommendation) throw new Error("Reasoning selected a test outside the circuit catalogue");
  }
  const hypotheses = output.hypotheses.map((modelOutput, index) => buildModelHypothesis({
    modelOutput, sessionId, turnId, itemIndex: itemIndex + index,
  }));
  const result = enforcedReasoningResultSchema.parse({
    kind: output.kind, message: output.message, why: output.why,
    supportingItemIds: output.supportingItemIds, recommendation,
    uncertaintyBasis: output.uncertaintyBasis,
  });
  return { result, hypotheses };
}

module.exports = { reasonAboutTurn, assertContextBudget };
