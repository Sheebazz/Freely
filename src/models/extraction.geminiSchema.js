const { z } = require("zod");
const {
  extractionResponseSchema,
} = require("./extraction.schema");

function adaptForGemini(value) {
  if (Array.isArray(value)) {
    return value.map(adaptForGemini);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  const adapted = {};

  for (const [key, child] of Object.entries(value)) {
    if (
      key === "$schema" ||
      key === "minLength" ||
      key === "maxLength"
    ) {
      continue;
    }

    if (key === "const") {
      adapted.enum = [child];
      continue;
    }

    adapted[key] = adaptForGemini(child);
  }

  return adapted;
}

const extractionGeminiSchema = adaptForGemini(
  z.toJSONSchema(extractionResponseSchema)
);

module.exports = {
  extractionGeminiSchema,
};
