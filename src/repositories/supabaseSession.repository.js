const { supabase } = require("../config/supabase");
const { sessionItemSchema } = require("../models/sessionItem.schema");
const { enforcedReasoningResultSchema } = require("../models/reasoning.schema");
const {
  turnCompletionSchema,
  turnRequestHashSchema,
  turnSchema,
} = require("../models/turn.schema");

function toDatabaseItem(item) {
  const parsed = sessionItemSchema.parse(item);

  return {
    id: parsed.id,
    session_id: parsed.sessionId,
    turn_id: parsed.turnId,
    item_index: parsed.itemIndex,
    category: parsed.category,
    kind: parsed.kind ?? null,
    fact_type: parsed.factType ?? null,
    content: parsed.content,
    source_text: parsed.sourceText,
    subject: parsed.subject ?? null,
    value: parsed.value ?? null,
    unit: parsed.unit ?? null,
    test: parsed.test ?? null,
    result: parsed.result ?? null,
    provenance: parsed.provenance,
    measurement_context: parsed.measurementContext ?? null,
    supersedes_id: parsed.supersedesId ?? null,
    created_at: parsed.createdAt,
  };
}

function fromDatabaseItem(row) {
  return sessionItemSchema.parse({
    id: row.id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    itemIndex: row.item_index,
    category: row.category,
    ...(row.kind !== null ? { kind: row.kind } : {}),
    ...(row.kind === "trusted_fact" ? { factType: row.fact_type } : {}),
    content: row.content,
    sourceText: row.source_text,
    ...(row.kind === "measurement" || row.kind === "trusted_fact"
      ? {
          subject: row.subject,
          value: row.value,
          unit: row.unit,
        }
      : {}),
    ...(row.test !== null ? { test: row.test } : {}),
    ...(row.result !== null ? { result: row.result } : {}),
    provenance: row.provenance,
    verificationStatus: row.verification_status,
    ...(row.measurement_context != null ? { measurementContext: row.measurement_context } : {}),
    supersedesId: row.supersedes_id,
    createdAt: row.created_at,
  });
}

function fromDatabaseTurn(row) {
  return turnSchema.parse({
    id: row.id,
    sessionId: row.session_id,
    status: row.status,
    completionKind: row.completion_kind,
    completionPayload: row.completion_payload,
    requestHash: row.request_hash,
    reasoningResult: row.reasoning_result ?? null,
    replyToTurnId: row.reply_to_turn_id ?? null,
    finalizedRevision: row.finalized_revision ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

async function createSession({ id, circuitId, createdAt, accessTokenHash = null, boardDescription = null }) {
  const row = {
    id,
    circuit_id: circuitId,
    created_at: createdAt,
    ...(accessTokenHash !== null ? { access_token_hash: accessTokenHash } : {}),
    ...(boardDescription !== null ? { board_description: boardDescription } : {}),
  };

  const { data, error } = await supabase
    .from("sessions")
    .insert(row)
    .select()
    .single();

  if (error) {
    const failure = new Error("Failed to create session");
    failure.code = error.code;
    throw failure;
  }

  return {
    id: data.id,
    circuitId: data.circuit_id,
    boardDescription: data.board_description ?? null,
    stateRevision: data.state_revision,
    circuitContextHash: data.circuit_context_hash,
    createdAt: data.created_at,
  };
}

async function getSession(sessionId) {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get session: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return {
    id: data.id,
    circuitId: data.circuit_id,
    boardDescription: data.board_description ?? null,
    stateRevision: data.state_revision,
    circuitContextHash: data.circuit_context_hash,
    createdAt: data.created_at,
  };
}

// Server-only authorization: never include this hash in API responses/model context.
async function getSessionAccessHash(sessionId) {
  const { data, error } = await supabase.from("sessions").select("access_token_hash")
    .eq("id", sessionId).maybeSingle();
  if (error) throw new Error("Session authorization lookup failed");
  return data?.access_token_hash ?? null;
}

async function getItemsForSession(sessionId) {
  const { data, error } = await supabase
    .from("session_items")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .order("item_index", { ascending: true });

  if (error) {
    throw new Error(`Failed to get session items: ${error.message}`);
  }

  return data.map(fromDatabaseItem);
}

async function getItemsForTurn({ sessionId, turnId }) {
  const { data, error } = await supabase
    .from("session_items")
    .select("*")
    .eq("session_id", sessionId)
    .eq("turn_id", turnId)
    .order("item_index", { ascending: true });

  if (error) {
    throw new Error(`Failed to get turn items: ${error.message}`);
  }

  return data.map(fromDatabaseItem);
}

async function createTurn({ id, sessionId, requestHash }) {
  const parsedRequestHash = turnRequestHashSchema.parse(requestHash);

  const { data, error } = await supabase
    .rpc("create_turn", {
      p_session_id: sessionId,
      p_turn_id: id,
      p_request_hash: parsedRequestHash,
    })
    .single();

  if (error) {
    throw new Error(`Failed to create turn: ${error.message}`);
  }

  return fromDatabaseTurn(data);
}

async function getTurn({ id, sessionId }) {
  const { data, error } = await supabase
    .from("turns")
    .select("*")
    .eq("id", id)
    .eq("session_id", sessionId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get turn: ${error.message}`);
  }

  return data ? fromDatabaseTurn(data) : null;
}

async function finalizeTurn({
  id,
  sessionId,
  items,
  completion,
  reasoning = null,
}) {
  const parsedItems = items.map((item) => sessionItemSchema.parse(item));
  const parsedCompletion = turnCompletionSchema.parse(completion);

  for (const item of parsedItems) {
    if (item.sessionId !== sessionId) {
      throw new Error("Finalized item belongs to another session");
    }

    if (item.turnId !== id) {
      throw new Error("Finalized item belongs to another turn");
    }
  }

  const args = {
    p_session_id: sessionId,
    p_turn_id: id,
    p_items: parsedItems.map(toDatabaseItem),
    p_completion_kind: parsedCompletion.kind,
    p_completion_payload: parsedCompletion.payload,
  };
  if (reasoning !== null) {
    args.p_reasoning_result = enforcedReasoningResultSchema.parse(reasoning.result);
    if (parsedCompletion.kind === "clarification_required" && args.p_reasoning_result.kind !== "context_required") {
      throw new Error("Unresolved report requires context before guidance");
    }
    args.p_expected_revision = reasoning.expectedRevision;
    args.p_reply_to_turn_id = reasoning.replyToTurnId;
    args.p_circuit_hash = reasoning.circuitHash;
  }
  const { data, error } = await supabase
    .rpc(reasoning === null ? "finalize_turn" : "finalize_reasoning_turn", args)
    .single();

  if (error) {
    throw new Error(`Failed to finalize turn: ${error.message}`);
  }

  return fromDatabaseTurn(data);
}

async function getReasoningHistory(sessionId) {
  const { data, error } = await supabase.from("turns")
    .select("*").eq("session_id", sessionId).eq("status", "completed")
    .not("reasoning_result", "is", null)
    .order("finalized_revision", { ascending: true });
  if (error) throw new Error(`Failed to read reasoning history: ${error.message}`);
  return data.map(fromDatabaseTurn);
}

async function runTurnTransition({
  functionName,
  id,
  sessionId,
  errorPrefix,
}) {
  const { data, error } = await supabase
    .rpc(functionName, {
      p_session_id: sessionId,
      p_turn_id: id,
    })
    .single();

  if (error) {
    throw new Error(`${errorPrefix}: ${error.message}`);
  }

  return fromDatabaseTurn(data);
}

async function markTurnFailed({ id, sessionId }) {
  return runTurnTransition({
    functionName: "mark_turn_failed",
    id,
    sessionId,
    errorPrefix: "Failed to mark turn failed",
  });
}

async function retryFailedTurn({ id, sessionId }) {
  return runTurnTransition({
    functionName: "retry_failed_turn",
    id,
    sessionId,
    errorPrefix: "Failed to retry failed turn",
  });
}

async function saveChatInput({ sessionId, turnId, requestHash, userMessage, images }) {
  const { error } = await supabase.rpc("save_chat_input", { p_session_id: sessionId,
    p_turn_id: turnId, p_request_hash: requestHash, p_message: userMessage, p_images: images });
  if (error) throw Object.assign(new Error("Failed to save chat input"), { code: error.code });
}
async function getChatInputs(sessionId) {
  const { data, error } = await supabase.from("chat_inputs").select("*").eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw Object.assign(new Error("Failed to read chat inputs"), { code: error.code });
  return data.map(row => ({ turnId: row.turn_id, sessionId: row.session_id,
    userMessage: row.message, images: row.images, createdAt: row.created_at }));
}
module.exports = {
  saveChatInput, getChatInputs,
  createSession,
  getSessionAccessHash,
  createTurn,
  finalizeTurn,
  getItemsForSession,
  getItemsForTurn,
  getSession,
  getReasoningHistory,
  getTurn,
  markTurnFailed,
  retryFailedTurn,
};
