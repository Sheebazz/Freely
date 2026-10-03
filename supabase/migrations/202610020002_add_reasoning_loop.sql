-- THL-003: atomic reasoning replay and referential recommendation binding.
-- Forward-only. Historical extraction-only turns retain NULL guidance/context;
-- do not fabricate their answers, subject origins, or pending recommendations.
-- This validates a readable transport envelope, NOT THL-004 outcome consistency.
BEGIN;

ALTER TABLE public.sessions
  ADD COLUMN state_revision integer NOT NULL DEFAULT 0 CHECK (state_revision >= 0),
  ADD COLUMN circuit_context_hash text CHECK (circuit_context_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE public.turns
  ADD COLUMN reasoning_result jsonb,
  ADD COLUMN reply_to_turn_id uuid,
  ADD COLUMN finalized_revision integer CHECK (finalized_revision > 0);
ALTER TABLE public.turns ADD CONSTRAINT turns_reply_same_session_fk
  FOREIGN KEY (session_id, reply_to_turn_id) REFERENCES public.turns(session_id, id);
ALTER TABLE public.session_items ADD COLUMN measurement_context jsonb;

CREATE FUNCTION public.reasoning_text_valid(value jsonb, bound integer)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT (jsonb_typeof(value) = 'string'
    AND length(value #>> '{}') BETWEEN 1 AND bound
    AND (value #>> '{}') ~ U&'[^\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]') IS TRUE;
$$;

CREATE FUNCTION public.reasoning_uuid_valid(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT (jsonb_typeof(value) = 'string' AND (value #>> '{}') ~*
    '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$') IS TRUE;
$$;

CREATE FUNCTION public.valid_reasoning_result(payload jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT (jsonb_typeof(payload) = 'object'
    AND payload = jsonb_build_object(
      'kind', payload->'kind', 'message', payload->'message', 'why', payload->'why',
      'supportingItemIds', payload->'supportingItemIds', 'recommendation', payload->'recommendation')
    AND jsonb_typeof(payload->'kind') = 'string'
    AND payload->>'kind' IN ('next_test', 'context_required', 'unsupported_claim', 'cause_unestablished')
    AND public.reasoning_text_valid(payload->'message', 4000)
    AND public.reasoning_text_valid(payload->'why', 1000)
    AND CASE WHEN jsonb_typeof(payload->'supportingItemIds') = 'array' THEN
      jsonb_array_length(payload->'supportingItemIds') <= 32
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(payload->'supportingItemIds') AS ids(id)
        WHERE NOT public.reasoning_uuid_valid(id))
      ELSE false END
    AND CASE WHEN payload->'recommendation' = 'null'::jsonb THEN true
      WHEN jsonb_typeof(payload->'recommendation') = 'object' THEN
        payload->'recommendation' = jsonb_build_object(
          'testId', payload->'recommendation'->'testId',
          'procedure', payload->'recommendation'->'procedure',
          'tool', payload->'recommendation'->'tool',
          'powerState', payload->'recommendation'->'powerState',
          'expectedResponseType', payload->'recommendation'->'expectedResponseType',
          'requestedSubject', payload->'recommendation'->'requestedSubject')
        AND public.reasoning_text_valid(payload->'recommendation'->'testId', 200)
        AND public.reasoning_text_valid(payload->'recommendation'->'procedure', 2000)
        AND public.reasoning_text_valid(payload->'recommendation'->'tool', 200)
        AND public.reasoning_text_valid(payload->'recommendation'->'powerState', 100)
        AND public.reasoning_text_valid(payload->'recommendation'->'requestedSubject', 300)
        AND jsonb_typeof(payload->'recommendation'->'expectedResponseType') = 'string'
        AND payload->'recommendation'->>'expectedResponseType' IN ('measurement', 'observation', 'test_result')
      ELSE false END) IS TRUE;
$$;

CREATE FUNCTION public.valid_measurement_context(payload jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT (jsonb_typeof(payload) = 'object'
    AND payload = jsonb_build_object('subjectOrigin', payload->'subjectOrigin',
      'recommendationTurnId', payload->'recommendationTurnId')
    AND CASE WHEN payload->>'subjectOrigin' = 'user_span' THEN
      payload->'recommendationTurnId' = 'null'::jsonb
      WHEN payload->>'subjectOrigin' = 'recommended_test' THEN
      public.reasoning_uuid_valid(payload->'recommendationTurnId')
      ELSE false END) IS TRUE;
$$;

ALTER TABLE public.turns ADD CONSTRAINT turns_reasoning_readable_check
  CHECK ((reasoning_result IS NULL OR (status = 'completed'
    AND finalized_revision IS NOT NULL AND public.valid_reasoning_result(reasoning_result))) IS TRUE);
ALTER TABLE public.session_items ADD CONSTRAINT session_items_measurement_context_check
  CHECK ((measurement_context IS NULL OR (category = 'evidence' AND kind = 'measurement'
    AND public.valid_measurement_context(measurement_context))) IS TRUE);
CREATE UNIQUE INDEX turns_session_finalized_revision
  ON public.turns(session_id, finalized_revision) WHERE finalized_revision IS NOT NULL;

-- The existing finalizer is replaced below, preserving its signature and all
-- evidence/correction checks. It locks the session and increments its revision
-- for EVERY finalization, including legacy raw-RPC callers.
CREATE OR REPLACE FUNCTION public.finalize_turn(
  p_session_id uuid,
  p_turn_id uuid,
  p_items jsonb,
  p_completion_kind text,
  p_completion_payload jsonb
)
RETURNS SETOF public.turns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_turn public.turns%ROWTYPE;
  v_item jsonb;
  v_supersedes_id uuid;
  v_target_session_id uuid;
  v_target_category text;
  v_target_kind text;
  v_revision integer;
  v_recommendation_turn_id uuid;
  v_requested public.turns%ROWTYPE;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'p_items must be a JSON array';
  END IF;

  IF p_completion_kind IS NULL
     OR p_completion_kind NOT IN ('accepted', 'clarification_required') THEN
    RAISE EXCEPTION 'Unsupported completion kind: %', p_completion_kind;
  END IF;

  IF p_completion_kind = 'accepted' AND p_completion_payload IS NOT NULL THEN
    RAISE EXCEPTION 'Accepted completion must not have a payload';
  END IF;

  IF p_completion_kind = 'clarification_required' AND (
    p_completion_payload IS NULL
    OR jsonb_typeof(p_completion_payload) <> 'object'
  ) THEN
    RAISE EXCEPTION 'Clarification completion requires an object payload';
  END IF;

  IF p_completion_kind = 'clarification_required' AND
     coalesce(p_completion_payload->>'reason', '') NOT IN (
       'semantic_ambiguity',
       'extraction_unrecoverable'
     ) THEN
    RAISE EXCEPTION 'Unsupported clarification reason';
  END IF;

  IF p_completion_kind = 'clarification_required' AND
     p_completion_payload->>'reason' = 'semantic_ambiguity' THEN
    IF coalesce(jsonb_typeof(p_completion_payload->'unresolved'), '') <> 'array' THEN
      RAISE EXCEPTION 'Semantic ambiguity requires unresolved items';
    END IF;

    IF jsonb_array_length(p_completion_payload->'unresolved') = 0 THEN
      RAISE EXCEPTION 'Semantic ambiguity requires unresolved items';
    END IF;
  END IF;

  IF p_completion_kind = 'clarification_required' AND
     p_completion_payload->>'reason' = 'extraction_unrecoverable' AND
     coalesce(length(trim(p_completion_payload->>'detail')), 0) = 0 THEN
    RAISE EXCEPTION 'Unrecoverable extraction requires detail';
  END IF;

  IF p_completion_kind = 'clarification_required'
     AND NOT public.valid_turn_clarification(p_completion_payload) THEN
    RAISE EXCEPTION 'Clarification payload violates reader schema';
  END IF;

  SELECT state_revision INTO v_revision FROM public.sessions
  WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session does not exist'; END IF;

  SELECT *
  INTO v_turn
  FROM public.turns
  WHERE session_id = p_session_id
    AND id = p_turn_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turn does not exist for this session';
  END IF;

  IF v_turn.status <> 'processing' THEN
    RAISE EXCEPTION 'Turn finalization requires processing status';
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Each finalized item must be a JSON object';
    END IF;

    IF (v_item->>'session_id')::uuid IS DISTINCT FROM p_session_id THEN
      RAISE EXCEPTION 'Session item does not belong to the finalized session';
    END IF;

    IF (v_item->>'turn_id')::uuid IS DISTINCT FROM p_turn_id THEN
      RAISE EXCEPTION 'Session item does not belong to the finalized turn';
    END IF;

    v_supersedes_id := NULLIF(v_item->>'supersedes_id', '')::uuid;

    IF v_supersedes_id IS NOT NULL THEN
      SELECT session_id, category, kind
      INTO v_target_session_id, v_target_category, v_target_kind
      FROM public.session_items
      WHERE id = v_supersedes_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Correction target does not exist';
      END IF;

      IF v_target_session_id <> p_session_id THEN
        RAISE EXCEPTION 'Correction target belongs to another session';
      END IF;

      IF v_target_category IS DISTINCT FROM (v_item->>'category')
         OR v_target_kind IS DISTINCT FROM (v_item->>'kind') THEN
        RAISE EXCEPTION
          'Correction cannot change item category or evidence kind';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM public.session_items
        WHERE supersedes_id = v_supersedes_id
      ) THEN
        RAISE EXCEPTION 'Correction target is already superseded';
      END IF;
    END IF;

    IF v_item->'measurement_context'->>'subjectOrigin' = 'recommended_test' THEN
      SELECT * INTO v_requested FROM public.turns
      WHERE id = (v_item->'measurement_context'->>'recommendationTurnId')::uuid
        AND session_id = p_session_id AND status = 'completed';
      IF NOT FOUND OR v_requested.finalized_revision IS NULL
        OR EXISTS (SELECT 1 FROM public.turns newer WHERE newer.session_id = p_session_id
          AND newer.finalized_revision > v_requested.finalized_revision
          AND newer.reasoning_result->'recommendation' IS NOT NULL
          AND newer.reasoning_result->'recommendation' <> 'null'::jsonb)
        OR v_requested.reasoning_result->'recommendation'->>'expectedResponseType' IS DISTINCT FROM 'measurement'
        OR v_requested.reasoning_result->'recommendation'->>'requestedSubject' IS DISTINCT FROM v_item->>'subject' THEN
        RAISE EXCEPTION 'Measurement subject is not bound to the current session recommendation';
      END IF;
      v_recommendation_turn_id := v_requested.id;
    END IF;

    INSERT INTO public.session_items (
      id,
      session_id,
      turn_id,
      item_index,
      category,
      kind,
      fact_type,
      content,
      source_text,
      subject,
      value,
      unit,
      test,
      result,
      provenance,
      measurement_context,
      supersedes_id,
      created_at
    )
    VALUES (
      (v_item->>'id')::uuid,
      p_session_id,
      p_turn_id,
      (v_item->>'item_index')::integer,
      v_item->>'category',
      v_item->>'kind',
      v_item->>'fact_type',
      v_item->>'content',
      v_item->>'source_text',
      v_item->>'subject',
      CASE
        WHEN v_item->'value' IS NULL OR v_item->'value' = 'null'::jsonb
          THEN NULL
        ELSE v_item->'value'
      END,
      v_item->>'unit',
      v_item->>'test',
      v_item->>'result',
      v_item->'provenance',
      CASE WHEN v_item->'measurement_context' = 'null'::jsonb THEN NULL ELSE v_item->'measurement_context' END,
      v_supersedes_id,
      (v_item->>'created_at')::timestamptz
    );
  END LOOP;

  UPDATE public.sessions SET state_revision = state_revision + 1
    WHERE id = p_session_id RETURNING state_revision INTO v_revision;

  UPDATE public.turns
  SET finalized_revision = v_revision,
      reply_to_turn_id = v_recommendation_turn_id,
      status = 'completed',
      completion_kind = p_completion_kind,
      completion_payload = p_completion_payload,
      updated_at = now()
  WHERE session_id = p_session_id
    AND id = p_turn_id
  RETURNING * INTO v_turn;

  RETURN NEXT v_turn;
END;
$$;

CREATE FUNCTION public.finalize_reasoning_turn(
  p_session_id uuid, p_turn_id uuid, p_items jsonb,
  p_completion_kind text, p_completion_payload jsonb,
  p_reasoning_result jsonb, p_expected_revision integer,
  p_reply_to_turn_id uuid, p_circuit_hash text
)
RETURNS SETOF public.turns LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_requested public.turns%ROWTYPE;
  v_turn public.turns%ROWTYPE;
  v_item jsonb;
  v_ref jsonb;
BEGIN
  IF NOT public.valid_reasoning_result(p_reasoning_result) THEN
    RAISE EXCEPTION 'Reasoning result violates reader envelope';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0
    OR p_circuit_hash IS NULL OR p_circuit_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Reasoning requires a session revision and circuit hash';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'p_items must be a JSON array';
  END IF;
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session does not exist'; END IF;
  IF v_session.state_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'Session changed while reasoning; retry the turn against current state';
  END IF;
  IF v_session.circuit_context_hash IS NOT NULL
    AND v_session.circuit_context_hash <> p_circuit_hash THEN
    RAISE EXCEPTION 'Circuit context changed; start a new session';
  END IF;
  IF p_reply_to_turn_id IS NOT NULL THEN
    SELECT * INTO v_requested FROM public.turns WHERE id = p_reply_to_turn_id
      AND session_id = p_session_id AND status = 'completed';
    IF NOT FOUND OR v_requested.finalized_revision IS NULL
      OR EXISTS (SELECT 1 FROM public.turns newer WHERE newer.session_id = p_session_id
        AND newer.finalized_revision > v_requested.finalized_revision
        AND newer.reasoning_result->'recommendation' IS NOT NULL
        AND newer.reasoning_result->'recommendation' <> 'null'::jsonb)
      OR v_requested.reasoning_result->'recommendation' IS NULL
      OR v_requested.reasoning_result->'recommendation' = 'null'::jsonb THEN
      RAISE EXCEPTION 'Reply target is not the current recommendation in this session';
    END IF;
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF v_item->>'kind' = 'measurement' THEN
      IF NOT public.valid_measurement_context(v_item->'measurement_context') THEN
        RAISE EXCEPTION 'Reasoning measurements require explicit subject origin';
      END IF;
      IF v_item->'measurement_context'->>'subjectOrigin' = 'recommended_test' AND (
        p_reply_to_turn_id IS NULL
        OR (v_item->'measurement_context'->>'recommendationTurnId')::uuid IS DISTINCT FROM p_reply_to_turn_id
      ) THEN RAISE EXCEPTION 'Measurement does not match this turn reply binding'; END IF;
    END IF;
  END LOOP;
  FOR v_ref IN SELECT value FROM jsonb_array_elements(p_reasoning_result->'supportingItemIds') LOOP
    IF NOT EXISTS (SELECT 1 FROM public.session_items existing
      WHERE existing.id = (v_ref #>> '{}')::uuid AND existing.session_id = p_session_id
      AND NOT EXISTS (SELECT 1 FROM public.session_items correction WHERE correction.supersedes_id = existing.id)
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) AS incoming(item)
        WHERE item->>'supersedes_id' = existing.id::text))
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) AS incoming(item)
        WHERE item->>'id' = v_ref #>> '{}'
          AND item->>'session_id' = p_session_id::text) THEN
      RAISE EXCEPTION 'Reasoning references an unknown, cross-session, or superseded item';
    END IF;
  END LOOP;
  PERFORM public.finalize_turn(p_session_id, p_turn_id, p_items, p_completion_kind, p_completion_payload);
  UPDATE public.sessions SET circuit_context_hash = p_circuit_hash WHERE id = p_session_id;
  UPDATE public.turns SET reasoning_result = p_reasoning_result,
    reply_to_turn_id = p_reply_to_turn_id
    WHERE id = p_turn_id AND session_id = p_session_id RETURNING * INTO v_turn;
  RETURN NEXT v_turn;
END;
$$;

REVOKE ALL ON FUNCTION public.reasoning_text_valid(jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reasoning_uuid_valid(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.valid_reasoning_result(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.valid_measurement_context(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_reasoning_turn(uuid,uuid,jsonb,text,jsonb,jsonb,integer,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reasoning_text_valid(jsonb, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.reasoning_uuid_valid(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.valid_reasoning_result(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.valid_measurement_context(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_reasoning_turn(uuid,uuid,jsonb,text,jsonb,jsonb,integer,uuid,text) TO service_role;
COMMIT;
