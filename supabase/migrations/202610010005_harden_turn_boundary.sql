-- Post-audit boundary repair. PostgreSQL 17+ (live audit: 17.6).
-- Preserves applied migrations 001-004 and existing rows.
BEGIN;

ALTER TABLE public.turns
  DROP CONSTRAINT turns_completion_state_check,
  ADD CONSTRAINT turns_completion_state_check
  CHECK ((
    (status IN ('processing', 'failed')
      AND completion_kind IS NULL AND completion_payload IS NULL)
    OR
    (status = 'completed' AND CASE
      WHEN completion_kind = 'accepted' THEN completion_payload IS NULL
      WHEN completion_kind = 'clarification_required' THEN
        jsonb_typeof(completion_payload) = 'object'
        AND CASE completion_payload->>'reason'
          WHEN 'semantic_ambiguity' THEN CASE
            WHEN jsonb_typeof(completion_payload->'unresolved') = 'array'
              THEN jsonb_array_length(completion_payload->'unresolved') > 0
            ELSE false END
          WHEN 'extraction_unrecoverable' THEN
            length(trim(completion_payload->>'detail')) > 0
          ELSE false END
      ELSE false END)
  ) IS TRUE);

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


-- Runtime code does not need maintenance/locking authority.
-- Database-owner and autovacuum authority are unaffected.
REVOKE MAINTAIN ON TABLE public.sessions, public.turns, public.session_items
FROM service_role;

COMMIT;
