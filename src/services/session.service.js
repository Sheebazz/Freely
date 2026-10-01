const { randomUUID } = require("crypto");
const { sessionItemSchema } = require("../models/sessionItem.schema");
const { extractedItemSchema } = require("../models/extraction.schema");
const {
  correctionCandidatesSchema,
} = require("../models/correctionContext.schema");

function validateSourceText({ extractedItem, userMessage }) {
  if (typeof userMessage !== "string" || userMessage.length === 0) {
    throw new Error("userMessage is required to verify sourceText");
  }

  if (!userMessage.includes(extractedItem.sourceText)) {
    throw new Error(
      "sourceText must be an exact span from the original user message"
    );
  }

  return true;
}

function provenanceFor(item) {
  if (item.category === "observation") {
    return {
      actor: "user",
      method: "reported_observation",
    };
  }

  if (item.category === "hypothesis") {
    return {
      actor: "user",
      method: "reported_claim",
    };
  }

  if (item.category === "evidence" && item.kind === "measurement") {
    return {
      actor: "user",
      method: "reported_measurement",
    };
  }

  if (item.category === "evidence" && item.kind === "test_result") {
    return {
      actor: "user",
      method: "reported_test_result",
    };
  }

  throw new Error("Unsupported extracted item");
}

function buildSessionItem({
  extractedItem,
  sessionId,
  turnId,
  itemIndex,
  resolvedSupersedesId = null,
  createdAt = new Date().toISOString(),
}) {
  const parsedExtractedItem = extractedItemSchema.parse(extractedItem);
  const hasCorrectionRef =
    parsedExtractedItem.correctionRef !== null &&
    parsedExtractedItem.correctionRef !== undefined;
  const hasResolvedTarget = resolvedSupersedesId !== null;

  if (hasCorrectionRef !== hasResolvedTarget) {
    throw new Error(
      "correctionRef and resolvedSupersedesId must be provided together"
    );
  }

  const { correctionRef: _correctionRef, ...persistableItem } =
    parsedExtractedItem;

  const storedItem = {
    ...persistableItem,
    id: randomUUID(),
    sessionId,
    turnId,
    itemIndex,
    createdAt,
    supersedesId: resolvedSupersedesId,
    provenance: provenanceFor(parsedExtractedItem),
  };

  return sessionItemSchema.parse(storedItem);
}

function currentItems(items) {
  const supersededIds = new Set(
    items
      .map((item) => item.supersedesId)
      .filter((id) => id !== null)
  );

  return items.filter((item) => !supersededIds.has(item.id));
}

function buildCorrectionContext(items) {
  const parsedItems = items.map((item) =>
    sessionItemSchema.parse(item)
  );

  const sessionIds = new Set(
    parsedItems.map((item) => item.sessionId)
  );

  if (sessionIds.size > 1) {
    throw new Error(
      "Correction context cannot contain items from multiple sessions"
    );
  }

  const activeItems = currentItems(parsedItems);
  const targets = new Map();

  const candidates = activeItems.map((item) => {
    const ref = `candidate-${randomUUID()}`;
    targets.set(ref, item.id);

    if (item.category === "observation") {
      return {
        ref,
        category: item.category,
        content: item.content,
      };
    }

    if (item.category === "hypothesis") {
      return {
        ref,
        category: item.category,
        content: item.content,
      };
    }

    if (item.category === "evidence" && item.kind === "measurement") {
      return {
        ref,
        category: item.category,
        kind: item.kind,
        content: item.content,
        subject: item.subject,
        value: item.value,
        unit: item.unit,
      };
    }

    if (item.category === "evidence" && item.kind === "test_result") {
      return {
        ref,
        category: item.category,
        kind: item.kind,
        content: item.content,
        test: item.test,
        result: item.result,
      };
    }

    throw new Error("Unsupported current session item");
  });

  return {
    candidates: correctionCandidatesSchema.parse(candidates),
    targets,
  };
}

function resolveCorrectionRef({ correctionRef, targets }) {
  if (correctionRef === null || correctionRef === undefined) {
    return null;
  }

  if (!(targets instanceof Map)) {
    throw new Error("Correction targets must be a Map");
  }

  const targetId = targets.get(correctionRef);

  if (!targetId) {
    throw new Error(
      "correctionRef does not reference a current session item"
    );
  }

  return targetId;
}

function validateCorrection({ items, newItem }) {
  if (!newItem.supersedesId) {
    return;
  }

  const oldItem = items.find(
    (item) => item.id === newItem.supersedesId
  );

  if (!oldItem) {
    throw new Error("Correction target does not exist");
  }

  if (oldItem.sessionId !== newItem.sessionId) {
    throw new Error("Correction target belongs to another session");
  }

  const alreadySuperseded = items.some(
    (item) => item.supersedesId === oldItem.id
  );

  if (alreadySuperseded) {
    throw new Error("Correction target is already superseded");
  }
}

module.exports = {
  buildCorrectionContext,
  buildSessionItem,
  currentItems,
  resolveCorrectionRef,
  validateCorrection,
  validateSourceText,
};
