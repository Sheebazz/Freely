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

function correctionItemType(item) {
  if (item.category === "evidence") {
    return `evidence:${item.kind}`;
  }

  return item.category;
}

function numericTokens(sourceText) {
  // Accept complete numbers, including well-formed thousands grouping.
  // A decimal comma is ambiguous; never delete it and silently change scale.
  const matches = sourceText.match(
    /(?<![\p{L}\p{N}_.+,])[-+]?(?:\d{1,3}(?:,\d{3})+(?:\.\d*)?|\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?(?![\d,_]|\.\d|\.\.)/gu
  );

  return matches ?? [];
}

function sourceContainsLiteral(sourceText, value) {
  const literal = value.trim();

  if (literal.length === 0) {
    return false;
  }

  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const leftBoundary = /^[A-Za-z0-9]/.test(literal)
    ? "(?<![A-Za-z0-9])"
    : "";
  const rightBoundary = /[A-Za-z0-9]$/.test(literal)
    ? "(?![A-Za-z0-9])"
    : "";

  return new RegExp(
    `${leftBoundary}${escaped}${rightBoundary}`,
    "i"
  ).test(sourceText);
}

function validateMeasurementValueAttestation(item) {
  if (
    item.category !== "evidence" ||
    item.kind !== "measurement"
  ) {
    return;
  }

  if (typeof item.value === "number") {
    const supported = numericTokens(item.sourceText).some(
      (token) => Number(token.replaceAll(",", "")) === item.value
    );

    if (!supported) {
      throw new Error(
        "measurement value must be supported by the exact sourceText"
      );
    }

    return;
  }

  if (!sourceContainsLiteral(item.sourceText, item.value)) {
    throw new Error(
      "measurement value must be supported by the exact sourceText"
    );
  }
}

function validateTestResultAttestation(item) {
  if (
    item.category !== "evidence" ||
    item.kind !== "test_result"
  ) {
    return;
  }

  if (!sourceContainsLiteral(item.sourceText, item.result)) {
    throw new Error(
      "test result must be supported by the exact sourceText"
    );
  }
}

// Unit spelling may be normalized, but never its scale or case-sensitive symbol.
const UNIT_SPELLINGS = {
  V: ["V", "volt", "volts"], mV: ["mV", "millivolt", "millivolts"],
  A: ["A", "amp", "amps", "ampere", "amperes"],
  mA: ["mA", "milliamp", "milliamps", "milliampere", "milliamperes"],
  ohm: ["ohm", "ohms", "Ω"], Hz: ["Hz", "hertz"],
};

function validateMeasurementMetadata(item, turnContext) {
  if (item.category !== "evidence" || item.kind !== "measurement") return;
  const subjectInSource = sourceContainsLiteral(item.sourceText, item.subject);
  const subjectFromContext = turnContext?.expectedResponseType === "measurement"
    && item.subject === turnContext.requestedSubject;
  if (!subjectInSource && !subjectFromContext) {
    throw new Error("measurement subject must be literal source text or the exact backend requestedSubject");
  }
  if (item.unit !== null) {
    const spellings = Object.hasOwn(UNIT_SPELLINGS, item.unit)
      ? UNIT_SPELLINGS[item.unit] : [item.unit];
    const readings = typeof item.value === "number"
      ? numericTokens(item.sourceText).filter(token => Number(token.replaceAll(",", "")) === item.value)
      : [item.value.trim()];
    const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const supported = spellings.some((spelling) => readings.some((reading) => {
      // Bind the unit to this reading, not to an identifier or another value.
      const pattern = `(?<![\\p{L}\\p{N}_.,])${escape(reading)}\\s*${escape(spelling)}(?![\\p{L}\\p{N}_])`;
      const flags = spelling.length > 2 && /^[a-z]+$/.test(spelling) ? "iu" : "u";
      return new RegExp(pattern, flags).test(item.sourceText);
    }));

    if (!supported) throw new Error("measurement unit must be explicitly supported by sourceText without changing scale");
  }
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

  if (
    candidate.category === "observation" ||
    candidate.category === "hypothesis"
  ) {
    return null;
  }

  throw new Error("Unsupported correction candidate");
}

function validateExtraction({
  output,
  userMessage,
  correctionCandidates = [],
  turnContext = null,
}) {
  const parsed = extractionResponseSchema.parse(output);
  const candidatesByRef = new Map(
    correctionCandidates.map((candidate) => [candidate.ref, candidate])
  );
  const candidateKeyCounts = new Map();

  for (const candidate of correctionCandidates) {
    const key = correctionCandidateKey(candidate);

    if (key !== null) {
      candidateKeyCounts.set(
        key,
        (candidateKeyCounts.get(key) ?? 0) + 1
      );
    }
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

    if (correctionItemType(item) !== correctionItemType(candidate)) {
      throw new Error(
        "correctionRef cannot change item category or evidence kind"
      );
    }

    const key = correctionCandidateKey(candidate);

    if (
      key !== null &&
      (candidateKeyCounts.get(key) ?? 0) > 1
    ) {
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
    validateMeasurementValueAttestation(item);
    validateMeasurementMetadata(item, turnContext);
    validateTestResultAttestation(item);
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
      turnContext: parsedTurnContext,
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
        turnContext: parsedTurnContext,
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
