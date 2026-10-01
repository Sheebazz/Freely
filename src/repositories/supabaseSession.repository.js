const { supabase } = require("../config/supabase");
const { sessionItemSchema } = require("../models/sessionItem.schema");
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
    content: parsed.content,
    source_text: parsed.sourceText,
    subject: parsed.subject ?? null,
    value: parsed.value ?? null,
    unit: parsed.unit ?? null,
    test: parsed.test ?? null,
    result: parsed.result ?? null,
    provenance: parsed.provenance,
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
    content: row.content,
    sourceText: row.source_text,
    ...(row.kind === "measurement"
      ? {
          subject: row.subject,
          value: row.value,
          unit: row.unit,
        }
      : {}),
    ...(row.test !== null ? { test: row.test } : {}),
    ...(row.result !== null ? { result: row.result } : {}),
    provenance: row.provenance,
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

async function createSession({ id, circuitId, createdAt }) {
  const row = {
    id,
    circuit_id: circuitId,
    created_at: createdAt,
  };

  const { data, error } = await supabase
    .from("sessions")
    .insert(row)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create session: ${error.message}`);
  }

  return {
    id: data.id,
    circuitId: data.circuit_id,
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
    createdAt: data.created_at,
  };
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

  const { data, error } = await supabase
    .rpc("finalize_turn", {
      p_session_id: sessionId,
      p_turn_id: id,
      p_items: parsedItems.map(toDatabaseItem),
      p_completion_kind: parsedCompletion.kind,
      p_completion_payload: parsedCompletion.payload,
    })
    .single();

  if (error) {
    throw new Error(`Failed to finalize turn: ${error.message}`);
  }

  return fromDatabaseTurn(data);
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

module.exports = {
  createSession,
  createTurn,
  finalizeTurn,
  getItemsForSession,
  getItemsForTurn,
  getSession,
  getTurn,
  markTurnFailed,
  retryFailedTurn,
};
