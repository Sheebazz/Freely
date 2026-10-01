const {
  extractionResponseSchema,
} = require("../models/extraction.schema");

const {
  validateSourceText,
} = require("./session.service");

const {
  turnContextSchema,
} = require("../models/turnContext.schema");
const {
  correctionCandidatesSchema,
} = require("../models/correctionContext.schema");

function normalizedText(value) {
  return typeof value === "string"
    ? value.trim().toLowerCase()
    : "";
}

function correctionCandidateKey(candidate) {
  if (
    candidate.category === "evidence" &&
    candidate.kind === "measurement"
  ) {
    return `measurement:${normalizedText(candidate.subject)}`;
  }

  if (
    candidate.category === "evidence" &&
    candidate.kind === "test_result"
  ) {
    return `test_result:${normalizedText(candidate.test)}`;
  }

  if (candidate.category === "observation") {
    return "observation";
  }

  if (candidate.category === "hypothesis") {
    return "hypothesis";
  }

  throw new Error("Unsupported correction candidate");
}

function validateExtraction({
  output,
  userMessage,
  correctionCandidates = [],
}) {
  const parsed = extractionResponseSchema.parse(output);
  const candidatesByRef = new Map(
    correctionCandidates.map((candidate) => [candidate.ref, candidate])
  );
  const candidateKeyCounts = new Map();

  for (const candidate of correctionCandidates) {
    const key = correctionCandidateKey(candidate);
    candidateKeyCounts.set(
      key,
      (candidateKeyCounts.get(key) ?? 0) + 1
    );
  }

  const acceptedItems = [];
  const backendUnresolved = [];

  for (const item of parsed.items) {
    if (
      item.correctionRef === null ||
      item.correctionRef === undefined
    ) {
      acceptedItems.push(item);
      continue;
    }

    const candidate = candidatesByRef.get(item.correctionRef);

    if (!candidate) {
      throw new Error(
        "correctionRef must reference a provided current session item"
      );
    }

    const key = correctionCandidateKey(candidate);

    if ((candidateKeyCounts.get(key) ?? 0) > 1) {
      backendUnresolved.push({
        sourceText: item.sourceText,
        reason:
          "multiple current session items could be the correction target; clarification is required",
      });
      continue;
    }

    acceptedItems.push(item);
  }

  const unresolvedBySourceText = new Map();

  for (const unresolvedItem of [
    ...backendUnresolved,
    ...parsed.unresolved,
  ]) {
    if (!unresolvedBySourceText.has(unresolvedItem.sourceText)) {
      unresolvedBySourceText.set(
        unresolvedItem.sourceText,
        unresolvedItem
      );
    }
  }

  const normalized = {
    items: acceptedItems,
    unresolved: [...unresolvedBySourceText.values()],
  };

  const classifiedSourceTexts = new Set();

  for (const item of normalized.items) {
    if (classifiedSourceTexts.has(item.sourceText)) {
      throw new Error(
        "The same sourceText cannot classify more than one item"
      );
    }

    classifiedSourceTexts.add(item.sourceText);
  }

  for (const unresolvedItem of normalized.unresolved) {
    if (classifiedSourceTexts.has(unresolvedItem.sourceText)) {
      throw new Error(
        "The same sourceText cannot appear in both items and unresolved"
      );
    }
  }

  for (const item of normalized.items) {
    validateSourceText({
      extractedItem: item,
      userMessage,
    });
  }

  for (const unresolvedItem of normalized.unresolved) {
    validateSourceText({
      extractedItem: unresolvedItem,
      userMessage,
    });
  }

  return normalized;
}

function validationReason(error) {
  if (error && typeof error.message === "string") {
    return error.message.slice(0, 1500);
  }

  return "Extraction failed backend validation";
}

async function extractUserMessage({
  provider,
  userMessage,
  turnContext = null,
  correctionCandidates = [],
}) {
  if (!provider || typeof provider.extract !== "function") {
    throw new Error("An extractor provider is required");
  }

  if (typeof userMessage !== "string" || userMessage.trim().length === 0) {
    throw new Error("userMessage must be a non-empty string");
  }

  const parsedTurnContext =
    turnContext === null
      ? null
      : turnContextSchema.parse(turnContext);

  const parsedCorrectionCandidates =
    correctionCandidatesSchema.parse(correctionCandidates);

  const candidateRefs = new Set(
    parsedCorrectionCandidates.map((candidate) => candidate.ref)
  );

  if (candidateRefs.size !== parsedCorrectionCandidates.length) {
    throw new Error("Correction candidate refs must be unique");
  }

  const firstOutput = await provider.extract({
    userMessage,
    turnContext: parsedTurnContext,
    correctionCandidates: parsedCorrectionCandidates,
  });

  try {
    return validateExtraction({
      output: firstOutput,
      userMessage,
      correctionCandidates: parsedCorrectionCandidates,
    });
  } catch (firstError) {
    if (typeof provider.repair !== "function") {
      throw firstError;
    }

    const repairedOutput = await provider.repair({
      userMessage,
      turnContext: parsedTurnContext,
      correctionCandidates: parsedCorrectionCandidates,
      rejectedOutput: firstOutput,
      reason: validationReason(firstError),
    });

    try {
      return validateExtraction({
        output: repairedOutput,
        userMessage,
        correctionCandidates: parsedCorrectionCandidates,
      });
    } catch (repairError) {
      return {
        status: "clarification_required",
        reason: "extraction_unrecoverable",
        detail: validationReason(repairError),
      };
    }
  }
}

module.exports = {
  extractUserMessage,
  validateExtraction,
};
