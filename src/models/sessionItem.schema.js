const { z } = require("zod");

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

const observationSchema = backendFieldsSchema.extend({
  category: z.literal("observation"),
  content: z.string().min(1),
  sourceText: z.string().min(1).max(1000),
  provenance: userProvenanceSchema.extend({
    method: z.literal("reported_observation"),
  }),
}).strict();

const measurementEvidenceSchema = backendFieldsSchema.extend({
  category: z.literal("evidence"),
  kind: z.literal("measurement"),
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
  test: z.string().min(1),
  result: z.string().min(1),
  content: z.string().min(1),
  sourceText: z.string().min(1).max(1000),
  provenance: userProvenanceSchema.extend({
    method: z.literal("reported_test_result"),
  }),
}).strict();

const hypothesisSchema = backendFieldsSchema.extend({
  category: z.literal("hypothesis"),
  content: z.string().min(1),
  sourceText: z.string().min(1).max(1000),
  provenance: userProvenanceSchema.extend({
    method: z.literal("reported_claim"),
  }),
}).strict();

const sessionItemSchema = z.union([
  observationSchema,
  measurementEvidenceSchema,
  testResultEvidenceSchema,
  hypothesisSchema,
]);

module.exports = {
  sessionItemSchema,
  observationSchema,
  measurementEvidenceSchema,
  testResultEvidenceSchema,
  hypothesisSchema,
};
