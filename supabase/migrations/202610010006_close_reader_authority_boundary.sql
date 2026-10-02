-- THL-002 review repair. Applied migrations remain unchanged.
-- Existing malformed finalized rows abort the migration, without alteration.
-- Existing trusted facts require human source/type curation before this migration.
BEGIN;
CREATE OR REPLACE FUNCTION public.valid_turn_clarification(payload jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $validator$
  SELECT (CASE
  WHEN jsonb_typeof(payload) <> 'object' THEN false
  WHEN payload->>'reason' = 'extraction_unrecoverable' THEN
    payload = jsonb_build_object('reason', 'extraction_unrecoverable', 'detail', payload->'detail')
    AND jsonb_typeof(payload->'detail') = 'string'
    AND length(payload->>'detail') BETWEEN 1 AND 1500
    AND (payload->>'detail') ~ U&'[^\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]'
  WHEN payload->>'reason' = 'semantic_ambiguity' THEN
    payload = jsonb_build_object('reason', 'semantic_ambiguity', 'unresolved', payload->'unresolved')
    AND CASE WHEN jsonb_typeof(payload->'unresolved') = 'array' THEN
      jsonb_array_length(payload->'unresolved') > 0
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(payload->'unresolved') AS entries(entry)
        WHERE NOT ((
          jsonb_typeof(entry) = 'object'
          AND entry = jsonb_build_object('sourceText', entry->'sourceText', 'reason', entry->'reason')
          AND jsonb_typeof(entry->'sourceText') = 'string'
          AND jsonb_typeof(entry->'reason') = 'string'
          AND length(entry->>'sourceText') BETWEEN 1 AND 1000
          AND length(entry->>'reason') BETWEEN 1 AND 500
        ) IS TRUE)
      )
    ELSE false END
  ELSE false
END) IS TRUE;
$validator$;
REVOKE ALL ON FUNCTION public.valid_turn_clarification(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.valid_turn_clarification(jsonb) TO service_role;

DO $audit$
DECLARE invalid_ids text;
BEGIN
  SELECT string_agg(id::text, ', ') INTO invalid_ids FROM (
    SELECT id FROM public.turns
    WHERE status = 'completed' AND completion_kind = 'clarification_required'
      AND NOT public.valid_turn_clarification(completion_payload)
    ORDER BY id LIMIT 20
  ) AS invalid;
  IF invalid_ids IS NOT NULL THEN
    RAISE EXCEPTION 'Existing malformed clarification turns require explicit repair; IDs: %', invalid_ids;
  END IF;
  IF EXISTS (SELECT 1 FROM public.session_items WHERE kind = 'trusted_fact') THEN
    RAISE EXCEPTION 'Existing trusted facts require reviewed source/type curation; run preflight. No row has been changed.';
  END IF;
END;
$audit$;

ALTER TABLE public.turns DROP CONSTRAINT turns_completion_state_check,
  ADD CONSTRAINT turns_completion_state_check
  CHECK ((CASE
  WHEN status IN ('processing', 'failed') THEN completion_kind IS NULL AND completion_payload IS NULL
  WHEN status = 'completed' AND completion_kind = 'accepted' THEN completion_payload IS NULL
  WHEN status = 'completed' AND completion_kind = 'clarification_required' THEN public.valid_turn_clarification(completion_payload)
  ELSE false END) IS TRUE);

ALTER TABLE public.session_items ADD COLUMN fact_type text;
ALTER TABLE public.session_items ADD CONSTRAINT session_items_trusted_fact_type_check
  CHECK ((CASE WHEN kind = 'trusted_fact' THEN
    fact_type IN ('topology', 'rating', 'label', 'part_number')
    ELSE fact_type IS NULL END) IS TRUE);

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
      v_supersedes_id,
      (v_item->>'created_at')::timestamptz
    );
  END LOOP;

  UPDATE public.turns
  SET status = 'completed',
      completion_kind = p_completion_kind,
      completion_payload = p_completion_payload,
      updated_at = now()
  WHERE session_id = p_session_id
    AND id = p_turn_id
  RETURNING * INTO v_turn;

  RETURN NEXT v_turn;
END;
$$;


REVOKE ALL
ON FUNCTION public.finalize_turn(uuid, uuid, jsonb, text, jsonb)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.finalize_turn(uuid, uuid, jsonb, text, jsonb)
TO service_role;



COMMIT;
