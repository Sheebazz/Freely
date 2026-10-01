const { z } = require("zod");

const baseCandidateFields = {
  ref: z.string().min(1).max(100),
  content: z.string().min(1),
};

const observationCorrectionCandidateSchema = z.object({
  ...baseCandidateFields,
  category: z.literal("observation"),
}).strict();

const measurementCorrectionCandidateSchema = z.object({
  ...baseCandidateFields,
  category: z.literal("evidence"),
  kind: z.literal("measurement"),
  subject: z.string().min(1),
  value: z.union([
    z.number(),
    z.string().min(1),
  ]),
  unit: z.string().min(1).nullable(),
}).strict();

const testResultCorrectionCandidateSchema = z.object({
  ...baseCandidateFields,
  category: z.literal("evidence"),
  kind: z.literal("test_result"),
  test: z.string().min(1),
  result: z.string().min(1),
}).strict();

const hypothesisCorrectionCandidateSchema = z.object({
  ...baseCandidateFields,
  category: z.literal("hypothesis"),
}).strict();

const correctionCandidateSchema = z.union([
  observationCorrectionCandidateSchema,
  measurementCorrectionCandidateSchema,
  testResultCorrectionCandidateSchema,
  hypothesisCorrectionCandidateSchema,
]);

const correctionCandidatesSchema = z.array(correctionCandidateSchema);

module.exports = {
  correctionCandidatesSchema,
};
