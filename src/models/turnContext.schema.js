const { z } = require("zod");

const turnContextSchema = z.object({
  expectedResponseType: z.enum([
    "observation",
    "measurement",
    "test_result",
    "hypothesis",
  ]).nullable().optional(),

  requestedSubject: z.string()
    .min(1)
    .max(300)
    .nullable()
    .optional(),
}).strict();

module.exports = {
  turnContextSchema,
};
