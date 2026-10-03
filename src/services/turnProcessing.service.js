const { imagesSchema, imageHash } = require("../models/chatInput.schema");
const { createHash } = require("crypto");
const { z } = require("zod");
const { turnContextSchema } = require("../models/turnContext.schema");
const { extractUserMessage, sourceContainsLiteral } = require("./extraction.service");
const { loadCircuitContext, prepareUserBoardContext } = require("./circuitContext.service");
const { reasonAboutTurn, assertContextBudget } = require("./reasoning.service");
const {
  buildCorrectionContext,
  buildSessionItem,
  resolveCorrectionRef,
  validateCorrection,
  currentItems,
  buildTrustedCircuitFact,
} = require("./session.service");

const REQUIRED_REPOSITORY_METHODS = [
  "createTurn",
  "finalizeTurn",
  "getItemsForSession",
  "getItemsForTurn",
  "getTurn",
  "markTurnFailed",
  "retryFailedTurn",
  "getSession",
  "getReasoningHistory",
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

function fingerprintTurnRequest({ userMessage, turnContext = null, replyToTurnId = null, images = [] }) {
  if (typeof userMessage !== "string" || userMessage.trim().length === 0) {
    throw new Error("userMessage must be a non-empty string");
  }

  const request = {
    userMessage,
    turnContext: normalizedTurnContext(turnContext),
  };
  // Preserve historical hashes for non-contextual THL-001/002 replay.
  if (replyToTurnId !== null) request.replyToTurnId = z.uuid().parse(replyToTurnId);
  if (images.length) request.images = imagesSchema.parse(images).map(image => ({ mimeType: image.mimeType, hash: imageHash(image) }));
  const payload = JSON.stringify(request);

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
    reasoning: turn.reasoningResult ?? null,
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
  reasoningProvider,
  sessionId,
  turnId,
  userMessage,
  turnContext = null,
  replyToTurnId = null,
  images = [],
  circuitLoader = loadCircuitContext,
}) {
  assertRepository(repository);
  images = imagesSchema.parse(images);
  z.uuid().parse(sessionId);
  z.uuid().parse(turnId);
  if (replyToTurnId !== null) z.uuid().parse(replyToTurnId);
  if (turnContext !== null) {
    // Historical contextual turns remain replayable. Caller-supplied context
    // is never accepted for a new reasoning turn.
    const historicalHash = fingerprintTurnRequest({ userMessage, turnContext });
    const historical = await repository.getTurn({ id: turnId, sessionId });
    if (replyToTurnId === null && historical?.status === "completed"
        && historical.reasoningResult == null) {
      assertTurnMatchesRequest({ turn: historical, requestHash: historicalHash });
      return replayCompletedTurn({ repository, turn: historical, sessionId, turnId });
    }
    throw new Error("Turn context must be resolved from a persisted recommendation, not supplied by the caller");
  }
  const requestHash = fingerprintTurnRequest({
    userMessage,
    replyToTurnId, images,
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

  let stage = "session";
  try {
    if (!reasoningProvider || typeof reasoningProvider.reason !== "function") {
      throw new Error("A reasoning provider is required for a new troubleshooting turn");
    }
    const session = await repository.getSession(sessionId);
    if (!session || session.id !== sessionId) throw new Error("Session does not exist");
    z.number().int().nonnegative().parse(session.stateRevision);
    const circuit = session.circuitId === "user-board"
      ? prepareUserBoardContext(session.boardDescription)
      : await circuitLoader(session.circuitId);
    if (circuit.context.id !== session.circuitId) throw new Error("Circuit context belongs to another circuit");
    if (session.circuitContextHash !== null && session.circuitContextHash !== circuit.hash) {
      throw new Error("Circuit context changed; start a new session with the reviewed fixture");
    }
    if (repository.saveChatInput) await repository.saveChatInput({ sessionId, turnId, requestHash, userMessage, images });
    const chatInputs = repository.getChatInputs ? await repository.getChatInputs(sessionId) : [];
    if (chatInputs.some(input => input.sessionId !== sessionId)) throw new Error("Chat history belongs to another session");
    const previousTurns = await repository.getReasoningHistory(sessionId);
    if (previousTurns.some((previous) => previous.sessionId !== sessionId)) {
      throw new Error("Reasoning history contains another session's turn");
    }
    const completedInputIds = new Set(previousTurns.map(previous => previous.id));
    const acceptedInputs = chatInputs.filter(input => completedInputIds.has(input.turnId) || input.turnId === turnId);
    const imageInputs = acceptedInputs.flatMap(input => input.images.map(image => ({ ...image, turnId: input.turnId })));
    const reasoningImages = imageInputs.length ? imageInputs : images.map(image => ({ ...image, turnId }));
    if (reasoningImages.length > 3) throw new Error("This conversation has reached its three-image limit; start a new chat");
    const latestRecommendation = previousTurns.filter((previous) =>
      previous.reasoningResult?.recommendation != null).at(-1);
    let parsedTurnContext = null;
    if (replyToTurnId !== null) {
      const requestedTurn = await repository.getTurn({ id: replyToTurnId, sessionId });
      if (!requestedTurn || requestedTurn.status !== "completed"
          || requestedTurn.id !== latestRecommendation?.id
          || !requestedTurn.reasoningResult?.recommendation) {
        throw new Error("Reply target is not the current recommendation in this session");
      }
      const recommendation = requestedTurn.reasoningResult.recommendation;
      parsedTurnContext = turnContextSchema.parse({
        expectedResponseType: recommendation.expectedResponseType,
        requestedSubject: recommendation.requestedSubject,
      });
    }
    const history = await repository.getItemsForSession(sessionId);
    if (history.some((item) => item.sessionId !== sessionId)) {
      throw new Error("Session history contains another session's items");
    }
    const { candidates, targets } = buildCorrectionContext(history);
    assertContextBudget({ userMessage, circuit: circuit.context,
      items: currentItems(history), previousTurns });

    stage = "extraction";
    const extraction = await extractUserMessage({
      provider,
      userMessage,
      turnContext: parsedTurnContext,
      correctionCandidates: candidates,
    });

    const storedItems = [];
    const correctionValidationItems = [...history];

    for (const [itemIndex, extractedItem] of (extraction.items ?? []).entries()) {
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
        ...(extractedItem.kind === "measurement" ? {
          measurementContext: sourceContainsLiteral(extractedItem.sourceText, extractedItem.subject)
            ? { subjectOrigin: "user_span", recommendationTurnId: null }
            : { subjectOrigin: "recommended_test", recommendationTurnId: replyToTurnId },
        } : {}),
      });

      validateCorrection({
        items: correctionValidationItems,
        newItem: storedItem,
      });

      storedItems.push(storedItem);
      correctionValidationItems.push(storedItem);
    }

    const completion = extraction.status === "clarification_required"
      ? { kind: "clarification_required", payload: {
          reason: "extraction_unrecoverable", detail: extraction.detail,
        } }
      : extraction.unresolved.length > 0
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

    // The fixture source is explicitly trusted for this session. Never derive
    // trusted facts from the model or from fault-case/evaluation answers.
    const existingFacts = new Set(history.filter((item) => item.kind === "trusted_fact"
      && item.provenance.sourceId === circuit.sourceId).map((item) => item.subject));
    for (const fact of circuit.facts) {
      if (existingFacts.has(fact.subject)) continue;
      storedItems.push(buildTrustedCircuitFact({ fact, trustedSourceId: circuit.sourceId,
        sessionId, turnId, itemIndex: storedItems.length }));
    }
    let reasoning;
    if (extraction.status === "clarification_required") {
      reasoning = {
        kind: "context_required",
        message: "Could you describe what happened? If you took a measurement, tell me where you measured and what the meter displayed.",
        why: "I could not reliably interpret the report, so choosing a test would require guessing.",
        recommendation: null, supportingItemIds: [],
      };
    } else if (extraction.unresolved.length > 0) {
      // Extraction has already identified a missing distinction. Ask about it
      // directly rather than spending a reasoning call that can bypass it.
      // Keep all ambiguities in completion metadata; ask one at a time.
      const unresolved = extraction.unresolved[0];
      const source = unresolved.sourceText.replace(/\s+/gu, " ").trim();
      const reason = unresolved.reason.replace(/\s+/gu, " ").trim();
      reasoning = {
        kind: "context_required",
        message: /correct|revis|retract|replac|earlier|previous/iu.test(reason)
          ? "Which earlier observation or result are you correcting, and what should it say?"
          : /reading|measur|value|volt|unit|estimate|number/iu.test(reason) || /\d/u.test(source)
          ? parsedTurnContext?.expectedResponseType === "measurement"
            ? "Was that a meter reading or an estimate? If you measured it, what number and unit did the meter show?"
            : "Was that a measurement or an estimate? If measured, where did you measure it, and what number and unit did the meter show?"
          : `What do you mean by “${source}”?`,
        why: "That detail will help me interpret what you reported.",
        recommendation: null, supportingItemIds: [],
      };
    } else {
      const context = {
        userMessage,
        circuit: circuit.context,
        items: currentItems([...history, ...storedItems]),
        unresolved: extraction.unresolved,
        replyToTurnId,
        requestedContext: parsedTurnContext,
        previousOutcomes: previousTurns.map((previous) => ({
          turnId: previous.id, result: previous.reasoningResult,
        })),
      };
      // Only completed earlier requests and the current request are model context.
      context.previousMessages = acceptedInputs.filter(input => input.turnId !== turnId)
        .map(input => ({ turnId: input.turnId, message: input.userMessage }));
      context.images = reasoningImages;
      stage = "reasoning";
      const response = await reasonAboutTurn({ provider: reasoningProvider, context,
        circuit, sessionId, turnId, itemIndex: storedItems.length });
      reasoning = response.result;
      storedItems.push(...response.hypotheses);
    }

    stage = "persistence";
    const completedTurn = await repository.finalizeTurn({
      id: turnId,
      sessionId,
      items: storedItems,
      completion,
      reasoning: {
        result: reasoning,
        expectedRevision: session.stateRevision,
        replyToTurnId,
        circuitHash: circuit.hash,
      },
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
      reasoning: completedTurn.reasoningResult,
    };
  } catch (error) {
    if (error && typeof error === "object") error.processingStage = stage;
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
