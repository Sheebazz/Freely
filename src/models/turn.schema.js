const { z } = require("zod");
const {
  unresolvedExtractionSchema,
} = require("./extraction.schema");

const turnRequestHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

const semanticAmbiguityPayloadSchema = z.object({
  reason: z.literal("semantic_ambiguity"),
  unresolved: z.array(unresolvedExtractionSchema).min(1),
}).strict();

const extractionUnrecoverablePayloadSchema = z.object({
  reason: z.literal("extraction_unrecoverable"),
  detail: z.string().min(1).max(1500).refine((value) => value.trim().length > 0),
}).strict();

const clarificationPayloadSchema = z.union([
  semanticAmbiguityPayloadSchema,
  extractionUnrecoverablePayloadSchema,
]);

const turnBaseFields = {
  id: z.uuid(),
  sessionId: z.uuid(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  requestHash: turnRequestHashSchema.nullable(),
};

const processingTurnSchema = z.object({
  ...turnBaseFields,
  status: z.literal("processing"),
  completionKind: z.null(),
  completionPayload: z.null(),
}).strict();

const failedTurnSchema = z.object({
  ...turnBaseFields,
  status: z.literal("failed"),
  completionKind: z.null(),
  completionPayload: z.null(),
}).strict();

const acceptedTurnSchema = z.object({
  ...turnBaseFields,
  status: z.literal("completed"),
  completionKind: z.literal("accepted"),
  completionPayload: z.null(),
}).strict();

const clarificationTurnSchema = z.object({
  ...turnBaseFields,
  status: z.literal("completed"),
  completionKind: z.literal("clarification_required"),
  completionPayload: clarificationPayloadSchema,
}).strict();

const turnSchema = z.union([
  processingTurnSchema,
  failedTurnSchema,
  acceptedTurnSchema,
  clarificationTurnSchema,
]);

const turnCompletionSchema = z.union([
  z.object({
    kind: z.literal("accepted"),
    payload: z.null(),
  }).strict(),
  z.object({
    kind: z.literal("clarification_required"),
    payload: clarificationPayloadSchema,
  }).strict(),
]);

module.exports = {
  turnCompletionSchema,
  turnSchema,
  turnRequestHashSchema,
};
