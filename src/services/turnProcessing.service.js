const { createHash } = require("crypto");
const { turnContextSchema } = require("../models/turnContext.schema");
const { extractUserMessage } = require("./extraction.service");
const {
  buildCorrectionContext,
  buildSessionItem,
  resolveCorrectionRef,
  validateCorrection,
} = require("./session.service");

const REQUIRED_REPOSITORY_METHODS = [
  "createTurn",
  "finalizeTurn",
  "getItemsForSession",
  "getItemsForTurn",
  "getTurn",
  "markTurnFailed",
  "retryFailedTurn",
];

function assertRepository(repository) {
  if (!repository || typeof repository !== "object") {
    throw new Error("A session repository is required");
  }

  for (const method of REQUIRED_REPOSITORY_METHODS) {
    if (typeof repository[method] !== "function") {
      throw new Error(`Session repository must implement ${method}()`);
    }
  }
}

function normalizedTurnContext(turnContext) {
  if (turnContext === null || turnContext === undefined) {
    return null;
  }

  const parsed = turnContextSchema.parse(turnContext);

  return {
    expectedResponseType: parsed.expectedResponseType ?? null,
    requestedSubject: parsed.requestedSubject ?? null,
  };
}

function fingerprintTurnRequest({ userMessage, turnContext = null }) {
  if (typeof userMessage !== "string" || userMessage.trim().length === 0) {
    throw new Error("userMessage must be a non-empty string");
  }

  const payload = JSON.stringify({
    userMessage,
    turnContext: normalizedTurnContext(turnContext),
  });

  return createHash("sha256").update(payload).digest("hex");
}

function assertTurnMatchesRequest({ turn, requestHash }) {
  if (turn.requestHash === null) {
    throw new Error(
      "Turn cannot be safely replayed because it has no request fingerprint"
    );
  }

  if (turn.requestHash !== requestHash) {
    throw new Error("Turn id is already bound to a different request");
  }
}

async function replayCompletedTurn({ repository, turn, sessionId, turnId }) {
  const items = await repository.getItemsForTurn({ sessionId, turnId });

  return {
    status: "completed",
    replayed: true,
    turn,
    items,
    completion: {
      kind: turn.completionKind,
      payload: turn.completionPayload,
    },
  };
}

async function acquireTurn({ repository, sessionId, turnId, requestHash }) {
  let turn = await repository.getTurn({ id: turnId, sessionId });

  if (turn) {
    assertTurnMatchesRequest({ turn, requestHash });

    if (turn.status !== "failed") {
      return { turn, ownsProcessing: false };
    }

    try {
      turn = await repository.retryFailedTurn({ id: turnId, sessionId });
      return { turn, ownsProcessing: true };
    } catch (retryError) {
      const racedTurn = await repository.getTurn({ id: turnId, sessionId });

      if (!racedTurn) {
        throw retryError;
      }

      assertTurnMatchesRequest({ turn: racedTurn, requestHash });

      if (racedTurn.status === "failed") {
        throw retryError;
      }

      return { turn: racedTurn, ownsProcessing: false };
    }
  }

  try {
    turn = await repository.createTurn({
      id: turnId,
      sessionId,
      requestHash,
    });

    return { turn, ownsProcessing: true };
  } catch (createError) {
    const racedTurn = await repository.getTurn({ id: turnId, sessionId });

    if (!racedTurn) {
      throw createError;
    }

    assertTurnMatchesRequest({ turn: racedTurn, requestHash });
    return { turn: racedTurn, ownsProcessing: false };
  }
}

async function recoverAfterProcessingError({
  repository,
  sessionId,
  turnId,
  requestHash,
  originalError,
}) {
  try {
    const latestTurn = await repository.getTurn({ id: turnId, sessionId });

    if (latestTurn) {
      assertTurnMatchesRequest({ turn: latestTurn, requestHash });
    }

    if (latestTurn?.status === "completed") {
      return replayCompletedTurn({
        repository,
        turn: latestTurn,
        sessionId,
        turnId,
      });
    }

    if (latestTurn?.status === "processing") {
      await repository.markTurnFailed({ id: turnId, sessionId });
    }
  } catch (recoveryError) {
    throw new AggregateError(
      [originalError, recoveryError],
      "Turn processing failed and recovery could not establish a safe final state"
    );
  }

  throw originalError;
}

async function processUserTurn({
  repository,
  provider,
  sessionId,
  turnId,
  userMessage,
  turnContext = null,
}) {
  assertRepository(repository);

  const parsedTurnContext = normalizedTurnContext(turnContext);
  const requestHash = fingerprintTurnRequest({
    userMessage,
    turnContext: parsedTurnContext,
  });

  const { turn, ownsProcessing } = await acquireTurn({
    repository,
    sessionId,
    turnId,
    requestHash,
  });

  if (turn.status === "completed") {
    return replayCompletedTurn({
      repository,
      turn,
      sessionId,
      turnId,
    });
  }

  if (turn.status === "processing" && !ownsProcessing) {
    return {
      status: "processing",
      reason: "turn_already_processing",
    };
  }

  if (turn.status !== "processing") {
    throw new Error(`Unsupported acquired turn status: ${turn.status}`);
  }

  try {
    const history = await repository.getItemsForSession(sessionId);
    const { candidates, targets } = buildCorrectionContext(history);

    const extraction = await extractUserMessage({
      provider,
      userMessage,
      turnContext: parsedTurnContext,
      correctionCandidates: candidates,
    });

    if (extraction.status === "clarification_required") {
      const completedTurn = await repository.finalizeTurn({
        id: turnId,
        sessionId,
        items: [],
        completion: {
          kind: "clarification_required",
          payload: {
            reason: "extraction_unrecoverable",
            detail: extraction.detail,
          },
        },
      });

      return {
        status: "completed",
        replayed: false,
        turn: completedTurn,
        items: [],
        completion: {
          kind: completedTurn.completionKind,
          payload: completedTurn.completionPayload,
        },
      };
    }

    const storedItems = [];
    const correctionValidationItems = [...history];

    for (const [itemIndex, extractedItem] of extraction.items.entries()) {
      const resolvedSupersedesId = resolveCorrectionRef({
        correctionRef: extractedItem.correctionRef,
        targets,
      });

      const storedItem = buildSessionItem({
        extractedItem,
        sessionId,
        turnId,
        itemIndex,
        resolvedSupersedesId,
      });

      validateCorrection({
        items: correctionValidationItems,
        newItem: storedItem,
      });

      storedItems.push(storedItem);
      correctionValidationItems.push(storedItem);
    }

    const completion = extraction.unresolved.length > 0
      ? {
          kind: "clarification_required",
          payload: {
            reason: "semantic_ambiguity",
            unresolved: extraction.unresolved,
          },
        }
      : {
          kind: "accepted",
          payload: null,
        };

    const completedTurn = await repository.finalizeTurn({
      id: turnId,
      sessionId,
      items: storedItems,
      completion,
    });

    return {
      status: "completed",
      replayed: false,
      turn: completedTurn,
      items: storedItems,
      completion: {
        kind: completedTurn.completionKind,
        payload: completedTurn.completionPayload,
      },
    };
  } catch (error) {
    return recoverAfterProcessingError({
      repository,
      sessionId,
      turnId,
      requestHash,
      originalError: error,
    });
  }
}

module.exports = {
  fingerprintTurnRequest,
  processUserTurn,
};
