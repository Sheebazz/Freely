-- THL-003 specialist repair: distinguish catalogue, access and evidence limits.
-- Historical answers remain readable; their missing origin is not backfilled.
BEGIN;
CREATE OR REPLACE FUNCTION public.valid_reasoning_result(payload jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT (jsonb_typeof(payload) = 'object'
    AND (payload - 'uncertaintyBasis') = jsonb_build_object(
      'kind', payload->'kind', 'message', payload->'message', 'why', payload->'why',
      'supportingItemIds', payload->'supportingItemIds', 'recommendation', payload->'recommendation')
    AND (NOT (payload ? 'uncertaintyBasis') OR payload->'uncertaintyBasis' = 'null'::jsonb
      OR (jsonb_typeof(payload->'uncertaintyBasis') = 'string'
        AND payload->>'uncertaintyBasis' IN ('catalogue_limit', 'evidence_limit', 'access_limit')))
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

CREATE OR REPLACE FUNCTION public.finalize_reasoning_turn(
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
  IF p_reasoning_result->>'kind' = 'cause_unestablished' THEN
    IF NOT ((jsonb_typeof(p_reasoning_result->'uncertaintyBasis') = 'string'
      AND p_reasoning_result->>'uncertaintyBasis' IN ('catalogue_limit', 'evidence_limit', 'access_limit')) IS TRUE) THEN
      RAISE EXCEPTION 'Unestablished cause requires an explicit uncertainty basis';
    END IF;
  ELSIF p_reasoning_result ? 'uncertaintyBasis'
    AND p_reasoning_result->'uncertaintyBasis' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'Uncertainty basis belongs only to an unestablished cause';
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

COMMIT;
