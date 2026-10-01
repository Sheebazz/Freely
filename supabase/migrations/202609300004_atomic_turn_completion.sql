-- Completed turns must carry replayable outcome metadata, and session items
-- may only be persisted through the atomic finalization function below.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.turns
    WHERE status = 'completed'
  ) THEN
    RAISE EXCEPTION
      'Cannot add turn completion metadata while legacy completed turns exist';
  END IF;
END;
$$;

ALTER TABLE public.turns
  ADD COLUMN completion_kind text,
  ADD COLUMN completion_payload jsonb;

ALTER TABLE public.turns
  ADD CONSTRAINT turns_completion_state_check
  CHECK (
    (
      status IN ('processing', 'failed')
      AND completion_kind IS NULL
      AND completion_payload IS NULL
    )
    OR
    (
      status = 'completed'
      AND (
        (
          completion_kind = 'accepted'
          AND completion_payload IS NULL
        )
        OR
        (
          completion_kind = 'clarification_required'
          AND completion_payload IS NOT NULL
          AND jsonb_typeof(completion_payload) = 'object'
          AND completion_payload->>'reason' IN (
            'semantic_ambiguity',
            'extraction_unrecoverable'
          )
          AND (
            (
              completion_payload->>'reason' = 'semantic_ambiguity'
              AND jsonb_typeof(completion_payload->'unresolved') = 'array'
              AND jsonb_array_length(completion_payload->'unresolved') > 0
            )
            OR
            (
              completion_payload->>'reason' = 'extraction_unrecoverable'
              AND length(trim(completion_payload->>'detail')) > 0
            )
          )
        )
      )
    )
  );

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
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'p_items must be a JSON array';
  END IF;

  IF p_completion_kind NOT IN ('accepted', 'clarification_required') THEN
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

    IF (v_item->>'session_id')::uuid <> p_session_id THEN
      RAISE EXCEPTION 'Session item does not belong to the finalized session';
    END IF;

    IF (v_item->>'turn_id')::uuid <> p_turn_id THEN
      RAISE EXCEPTION 'Session item does not belong to the finalized turn';
    END IF;

    v_supersedes_id := NULLIF(v_item->>'supersedes_id', '')::uuid;

    IF v_supersedes_id IS NOT NULL THEN
      SELECT session_id
      INTO v_target_session_id
      FROM public.session_items
      WHERE id = v_supersedes_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Correction target does not exist';
      END IF;

      IF v_target_session_id <> p_session_id THEN
        RAISE EXCEPTION 'Correction target belongs to another session';
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

-- Session items are immutable turn output. The backend reads them directly,
-- but new rows are written only through finalize_turn().
REVOKE INSERT, UPDATE, DELETE
ON TABLE public.session_items
FROM service_role;
