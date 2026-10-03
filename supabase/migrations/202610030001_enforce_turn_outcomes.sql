-- Forward-only: old guidance stays readable. All new reasoning writes are enforced.
BEGIN;
ALTER TABLE public.sessions ADD COLUMN access_token_hash text
  CHECK (access_token_hash ~ '^[0-9a-f]{64}$');
CREATE FUNCTION public.valid_new_reasoning_result(payload jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT (public.valid_reasoning_result(payload)
    AND CASE WHEN payload->>'kind' IN ('next_test', 'unsupported_claim') THEN
      jsonb_typeof(payload->'recommendation') = 'object'
      ELSE payload->'recommendation' = 'null'::jsonb END
    AND CASE WHEN payload->>'kind' = 'cause_unestablished' THEN
      jsonb_typeof(payload->'uncertaintyBasis') = 'string'
      AND payload->>'uncertaintyBasis' IN ('catalogue_limit', 'access_limit', 'evidence_limit')
      ELSE NOT (payload ? 'uncertaintyBasis') OR payload->'uncertaintyBasis' = 'null'::jsonb END
    AND ((payload->>'message') || chr(10) || (payload->>'why')) !~
      U&'(^|\000A)[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]*([-*•]|[0-9]+[.)])[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+') IS TRUE;
$$;
REVOKE ALL ON FUNCTION public.valid_new_reasoning_result(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.valid_new_reasoning_result(jsonb) TO service_role;
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
  IF NOT public.valid_new_reasoning_result(p_reasoning_result) THEN
    RAISE EXCEPTION 'Reasoning outcome content is inconsistent';
  END IF;
  IF p_completion_kind = 'clarification_required'
    AND p_reasoning_result->>'kind' IS DISTINCT FROM 'context_required' THEN
    RAISE EXCEPTION 'Unresolved report requires context before guidance';
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
          AND item->>'session_id' = p_session_id::text
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) AS replacements(replacement)
            WHERE replacement->>'supersedes_id' = item->>'id')) THEN
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
