const { z } = require("zod");

const verificationStatusSchema = z.enum(["established", "unverified"]);

const backendFieldsSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  turnId: z.string().uuid(),
  itemIndex: z.number().int().nonnegative(),
  createdAt: z.iso.datetime({ offset: true }),
  supersedesId: z.string().uuid().nullable(),
});

const userProvenanceSchema = z.object({
  actor: z.literal("user"),
  method: z.enum([
    "reported_observation",
    "reported_measurement",
    "reported_test_result",
    "reported_claim",
  ]),
}).strict();

const modelHypothesisProvenanceSchema = z.object({
  actor: z.literal("model"),
  method: z.literal("generated_hypothesis"),
}).strict();

const trustedFactProvenanceSchema = z.object({
  actor: z.literal("system"),
  method: z.literal("trusted_circuit_fact"),
  sourceId: z.string().min(1).max(200).refine(
    (value) => /\S/u.test(value),
    "sourceId must contain a non-whitespace character"
  ),
}).strict();

const observationSchema = backendFieldsSchema.extend({
  category: z.literal("observation"),
  verificationStatus: z.literal("unverified"),
  content: z.string().min(1),
  sourceText: z.string().min(1).max(1000),
  provenance: userProvenanceSchema.extend({
    method: z.literal("reported_observation"),
  }),
}).strict();

const measurementEvidenceSchema = backendFieldsSchema.extend({
  category: z.literal("evidence"),
  kind: z.literal("measurement"),
  verificationStatus: z.literal("established"),
  subject: z.string().min(1),
  value: z.union([
    z.number(),
    z.string().min(1),
  ]),
  unit: z.string().min(1).nullable(),
  content: z.string().min(1),
  sourceText: z.string().min(1).max(1000),
  provenance: userProvenanceSchema.extend({
    method: z.literal("reported_measurement"),
  }),
}).strict();

const testResultEvidenceSchema = backendFieldsSchema.extend({
  category: z.literal("evidence"),
  kind: z.literal("test_result"),
  verificationStatus: z.literal("established"),
  test: z.string().min(1),
  result: z.string().min(1),
  content: z.string().min(1),
  sourceText: z.string().min(1).max(1000),
  provenance: userProvenanceSchema.extend({
    method: z.literal("reported_test_result"),
  }),
}).strict();

const trustedFactEvidenceSchema = backendFieldsSchema.extend({
  category: z.literal("evidence"),
  kind: z.literal("trusted_fact"),
  factType: z.enum(["topology", "rating", "label", "part_number"]),
  verificationStatus: z.literal("established"),
  subject: z.string().min(1),
  value: z.union([
    z.number(),
    z.string().min(1),
    z.boolean(),
  ]),
  unit: z.string().min(1).nullable(),
  content: z.string().min(1),
  sourceText: z.string().min(1).max(1000),
  provenance: trustedFactProvenanceSchema,
}).strict();

const userHypothesisSchema = backendFieldsSchema.extend({
  category: z.literal("hypothesis"),
  verificationStatus: z.literal("unverified"),
  content: z.string().min(1),
  sourceText: z.string().min(1).max(1000),
  provenance: userProvenanceSchema.extend({
    method: z.literal("reported_claim"),
  }),
}).strict();

const modelHypothesisSchema = backendFieldsSchema.extend({
  category: z.literal("hypothesis"),
  verificationStatus: z.literal("unverified"),
  content: z.string().min(1),
  sourceText: z.string().min(1).max(1000),
  provenance: modelHypothesisProvenanceSchema,
}).strict();

const hypothesisSchema = z.union([
  userHypothesisSchema,
  modelHypothesisSchema,
]);

const sessionItemSchema = z.union([
  observationSchema,
  measurementEvidenceSchema,
  testResultEvidenceSchema,
  trustedFactEvidenceSchema,
  userHypothesisSchema,
  modelHypothesisSchema,
]);

module.exports = {
  verificationStatusSchema,
  sessionItemSchema,
  observationSchema,
  measurementEvidenceSchema,
  testResultEvidenceSchema,
  trustedFactEvidenceSchema,
  hypothesisSchema,
  userHypothesisSchema,
  modelHypothesisSchema,
};
