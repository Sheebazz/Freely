const { z } = require("zod");

const observationExtractionSchema = z.object({
  category: z.literal("observation"),
  content: z.string().min(1),
  sourceText: z.string().min(1).max(1000),
  correctionRef: z.string().min(1).nullable().optional(),
}).strict();

const measurementExtractionSchema = z.object({
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
  correctionRef: z.string().min(1).nullable().optional(),
}).strict();

const testResultExtractionSchema = z.object({
  category: z.literal("evidence"),
  kind: z.literal("test_result"),
  test: z.string().min(1),
  result: z.string().min(1),
  content: z.string().min(1),
  sourceText: z.string().min(1).max(1000),
  correctionRef: z.string().min(1).nullable().optional(),
}).strict();

const hypothesisExtractionSchema = z.object({
  category: z.literal("hypothesis"),
  content: z.string().min(1),
  sourceText: z.string().min(1).max(1000),
  correctionRef: z.string().min(1).nullable().optional(),
}).strict();

const extractedItemSchema = z.union([
  observationExtractionSchema,
  measurementExtractionSchema,
  testResultExtractionSchema,
  hypothesisExtractionSchema,
]);

const unresolvedExtractionSchema = z.object({
  sourceText: z.string().min(1).max(1000),
  reason: z.string().min(1).max(500),
}).strict();

const extractionResponseSchema = z.object({
  items: z.array(extractedItemSchema),
  unresolved: z.array(unresolvedExtractionSchema),
}).strict();

module.exports = {
  extractedItemSchema,
  unresolvedExtractionSchema,
  extractionResponseSchema,
};
