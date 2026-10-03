const { z } = require("zod");

const text = (max) => z.string().min(1).max(max)
  .refine((value) => value.trim().length > 0, "text must not be blank");
const outcomeKindSchema = z.enum([
  "next_test", "context_required", "unsupported_claim", "cause_unestablished",
]);
const uncertaintyBasisSchema = z.enum(["catalogue_limit", "evidence_limit", "access_limit"]);
const recommendationSchema = z.object({
  testId: text(200),
  procedure: text(2000),
  tool: text(200),
  powerState: text(100),
  expectedResponseType: z.enum(["measurement", "observation", "test_result"]),
  requestedSubject: text(300),
}).strict();

// Transport/readability bounds, not the THL-004 four-outcome validator.
// In particular, this does not prove that prose contains only one test, that
// kind agrees with recommendation, or that the electronics reasoning is sound.
const reasoningResultSchema = z.object({
  kind: outcomeKindSchema,
  message: text(4000),
  why: text(1000),
  supportingItemIds: z.array(z.uuid()).max(32),
  recommendation: recommendationSchema.nullable(),
  // Absent on historical answers: do not invent their uncertainty origin.
  uncertaintyBasis: uncertaintyBasisSchema.nullable().optional(),
}).strict();
const reasoningOutputSchema = z.object({
  kind: outcomeKindSchema,
  message: text(4000),
  why: text(1000),
  testId: text(200).nullable(),
  uncertaintyBasis: uncertaintyBasisSchema.nullable().default(null),
  supportingItemIds: z.array(z.uuid()).max(32),
  // Strip attempted category/status/provenance declarations. The backend
  // builds each claim as a model hypothesis, irrespective of those fields.
  hypotheses: z.array(z.object({ content: text(1000) })).max(8),
}).strict();
const measurementContextSchema = z.object({
  subjectOrigin: z.enum(["user_span", "recommended_test"]),
  recommendationTurnId: z.uuid().nullable(),
}).strict().refine((value) =>
  (value.subjectOrigin === "user_span") === (value.recommendationTurnId === null));

// New writes must agree with the selected outcome; historical transport remains readable.
function outcomeConsistent(value, test) {
  const requiresTest = ["next_test", "unsupported_claim"].includes(value.kind);
  return !/(?:^|\n)\s*(?:[-*•]|\d+[.)])\s+/m.test(value.message + "\n" + value.why)
    && requiresTest === (test !== null)
    && (value.kind === "cause_unestablished"
      ? value.uncertaintyBasis != null : value.uncertaintyBasis == null);
}
const enforcedReasoningResultSchema = reasoningResultSchema.refine(
  value => outcomeConsistent(value, value.recommendation), "Outcome content is inconsistent");
const enforcedReasoningOutputSchema = reasoningOutputSchema.refine(
  value => outcomeConsistent(value, value.testId), "Outcome content is inconsistent");

module.exports = {
  reasoningOutputSchema, reasoningResultSchema, enforcedReasoningOutputSchema, enforcedReasoningResultSchema, recommendationSchema,
  measurementContextSchema,
};
