-- Read-only preflight before migration 005. Every row must PASS.
SELECT 'PostgreSQL version supports MAINTAIN' AS check_name,
  CASE WHEN current_setting('server_version_num')::int >= 170000
    THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL
SELECT 'existing turn completion metadata is compatible',
  CASE WHEN NOT EXISTS (SELECT 1 FROM public.turns WHERE NOT ((
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
  ) IS TRUE))
    THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'evidence repair 004 is present',
  CASE WHEN EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='public.session_items'::regclass
      AND conname='session_items_structured_shape_check' AND convalidated)
    AND NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='public.session_items'::regclass
      AND conname='session_items_kind_check')
    THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'expected finalization function exists',
  CASE WHEN to_regprocedure('public.finalize_turn(uuid,uuid,jsonb,text,jsonb)') IS NOT NULL
    THEN 'PASS' ELSE 'FAIL' END;
