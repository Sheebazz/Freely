-- Read-only THL-001 database verification. This query changes no data.

SELECT
  'RLS enabled on sessions/session_items/turns' AS check_name,
  CASE WHEN (
    SELECT count(*)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('sessions', 'session_items', 'turns')
      AND c.relrowsecurity = true
  ) = 3 THEN 'PASS' ELSE 'FAIL' END AS result

UNION ALL

SELECT
  'turn completion columns exist',
  CASE WHEN (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'turns'
      AND (
        (column_name = 'completion_kind' AND data_type = 'text')
        OR (column_name = 'completion_payload' AND data_type = 'jsonb')
      )
  ) = 2 THEN 'PASS' ELSE 'FAIL' END

UNION ALL

SELECT
  'turn request_hash column exists',
  CASE WHEN EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'turns'
      AND column_name = 'request_hash'
      AND data_type = 'text'
  ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL

SELECT
  'turn constraints exist',
  CASE WHEN (
    SELECT count(*)
    FROM pg_constraint
    WHERE conrelid = 'public.turns'::regclass
      AND conname IN (
        'turns_completion_state_check',
        'turns_request_hash_format_check'
      )
  ) = 2 THEN 'PASS' ELSE 'FAIL' END

UNION ALL

SELECT
  'controlled turn functions exist',
  CASE WHEN
    to_regprocedure('public.finalize_turn(uuid,uuid,jsonb,text,jsonb)') IS NOT NULL
    AND to_regprocedure('public.create_turn(uuid,uuid,text)') IS NOT NULL
    AND to_regprocedure('public.mark_turn_failed(uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.retry_failed_turn(uuid,uuid)') IS NOT NULL
  THEN 'PASS' ELSE 'FAIL' END

UNION ALL

SELECT
  'no stale turn-lifecycle function variants remain',
  CASE WHEN
    (
      SELECT count(*)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'create_turn'
    ) = 1
    AND (
      SELECT count(*)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'mark_turn_failed'
    ) = 1
    AND (
      SELECT count(*)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'retry_failed_turn'
    ) = 1
    AND NOT EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('mark_turn_completed', 'transition_turn')
    )
  THEN 'PASS' ELSE 'FAIL' END

UNION ALL

SELECT
  'controlled turn functions are SECURITY DEFINER',
  CASE WHEN (
    SELECT count(*)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'finalize_turn',
        'create_turn',
        'mark_turn_failed',
        'retry_failed_turn'
      )
      AND p.prosecdef = true
  ) = 4 THEN 'PASS' ELSE 'FAIL' END

UNION ALL

SELECT
  'service_role can execute controlled turn functions',
  CASE WHEN
    has_function_privilege('service_role', 'public.finalize_turn(uuid,uuid,jsonb,text,jsonb)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.create_turn(uuid,uuid,text)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.mark_turn_failed(uuid,uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.retry_failed_turn(uuid,uuid)', 'EXECUTE')
  THEN 'PASS' ELSE 'FAIL' END

UNION ALL

SELECT
  'anon/authenticated cannot execute controlled turn functions',
  CASE WHEN
    NOT has_function_privilege('anon', 'public.finalize_turn(uuid,uuid,jsonb,text,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.create_turn(uuid,uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.mark_turn_failed(uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.retry_failed_turn(uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.finalize_turn(uuid,uuid,jsonb,text,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.create_turn(uuid,uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.mark_turn_failed(uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.retry_failed_turn(uuid,uuid)', 'EXECUTE')
  THEN 'PASS' ELSE 'FAIL' END

UNION ALL

SELECT
  'correction type continuity is enforced in finalize_turn',
  CASE WHEN EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'finalize_turn'
      AND pg_get_functiondef(p.oid) LIKE
        '%Correction cannot change item category or evidence kind%'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'session_items'
      AND t.tgname = 'session_items_correction_type_guard'
      AND NOT t.tgisinternal
  )
  AND to_regprocedure('public.enforce_session_item_correction_type()') IS NULL
  THEN 'PASS' ELSE 'FAIL' END

UNION ALL

SELECT
  'service_role session_items is SELECT-only',
  CASE WHEN
    has_table_privilege('service_role', 'public.session_items', 'SELECT')
    AND NOT has_table_privilege('service_role', 'public.session_items', 'INSERT')
    AND NOT has_table_privilege('service_role', 'public.session_items', 'UPDATE')
    AND NOT has_table_privilege('service_role', 'public.session_items', 'DELETE')
    AND NOT has_table_privilege('service_role', 'public.session_items', 'TRUNCATE')
    AND NOT has_table_privilege('service_role', 'public.session_items', 'REFERENCES')
    AND NOT has_table_privilege('service_role', 'public.session_items', 'TRIGGER')
  THEN 'PASS' ELSE 'FAIL' END

UNION ALL

SELECT
  'service_role turns is SELECT-only',
  CASE WHEN
    has_table_privilege('service_role', 'public.turns', 'SELECT')
    AND NOT has_table_privilege('service_role', 'public.turns', 'INSERT')
    AND NOT has_table_privilege('service_role', 'public.turns', 'UPDATE')
    AND NOT has_table_privilege('service_role', 'public.turns', 'DELETE')
    AND NOT has_table_privilege('service_role', 'public.turns', 'TRUNCATE')
    AND NOT has_table_privilege('service_role', 'public.turns', 'REFERENCES')
    AND NOT has_table_privilege('service_role', 'public.turns', 'TRIGGER')
  THEN 'PASS' ELSE 'FAIL' END

UNION ALL

SELECT
  'service_role sessions has only SELECT/INSERT/DELETE',
  CASE WHEN
    has_table_privilege('service_role', 'public.sessions', 'SELECT')
    AND has_table_privilege('service_role', 'public.sessions', 'INSERT')
    AND has_table_privilege('service_role', 'public.sessions', 'DELETE')
    AND NOT has_table_privilege('service_role', 'public.sessions', 'UPDATE')
    AND NOT has_table_privilege('service_role', 'public.sessions', 'TRUNCATE')
    AND NOT has_table_privilege('service_role', 'public.sessions', 'REFERENCES')
    AND NOT has_table_privilege('service_role', 'public.sessions', 'TRIGGER')
  THEN 'PASS' ELSE 'FAIL' END

UNION ALL

SELECT
  'anon/authenticated have no persistence-table privileges',
  CASE WHEN NOT EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN ('sessions', 'session_items', 'turns')
      AND grantee IN ('anon', 'authenticated')
  ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL

SELECT
  'no invalid completed turns',
  CASE WHEN NOT EXISTS (
    SELECT 1
    FROM public.turns
    WHERE status = 'completed'
      AND (
        completion_kind IS NULL
        OR (completion_kind = 'accepted' AND completion_payload IS NOT NULL)
        OR (
          completion_kind = 'clarification_required'
          AND completion_payload IS NULL
        )
      )
  ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL

SELECT
  'no persisted turn lacks a request fingerprint',
  CASE WHEN NOT EXISTS (
    SELECT 1
    FROM public.turns
    WHERE request_hash IS NULL
  ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL
SELECT 'verification_status is database generated with eligible evidence kinds',
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'session_items'
      AND column_name = 'verification_status' AND data_type = 'text'
      AND is_generated = 'ALWAYS'
      AND generation_expression LIKE '%measurement%'
      AND generation_expression LIKE '%test_result%'
      AND generation_expression LIKE '%trusted_fact%'
      AND generation_expression LIKE '%established%'
      AND generation_expression LIKE '%unverified%'
  ) THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'legacy kind constraint removed',
  CASE WHEN NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.session_items'::regclass
      AND conname = 'session_items_kind_check'
  ) THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'repair constraints validated and reject NULL expressions',
  CASE WHEN (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'public.session_items'::regclass AND contype = 'c'
      AND conname IN ('session_items_category_kind_check',
        'session_items_structured_shape_check', 'session_items_provenance_authority_check')
      AND convalidated AND pg_get_constraintdef(oid) LIKE '%IS TRUE%'
  ) = 3 THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'trusted_fact permitted by category/kind contract',
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.session_items'::regclass
      AND conname = 'session_items_category_kind_check'
      AND pg_get_constraintdef(oid) LIKE '%trusted_fact%'
  ) THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'no invalid persisted category/kind',
  CASE WHEN NOT EXISTS (SELECT 1 FROM public.session_items WHERE NOT (((category IN ('observation', 'hypothesis') AND kind IS NULL)
    OR (category = 'evidence' AND kind IN ('measurement', 'test_result', 'trusted_fact'))) IS TRUE))
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'no invalid persisted structured shape',
  CASE WHEN NOT EXISTS (SELECT 1 FROM public.session_items WHERE NOT ((
    length(content) > 0
    AND length(source_text) BETWEEN 1 AND 1000
    AND CASE
      WHEN category IN ('observation', 'hypothesis') THEN
        subject IS NULL AND value IS NULL AND unit IS NULL
        AND test IS NULL AND result IS NULL
      WHEN category = 'evidence' AND kind IN ('measurement', 'trusted_fact') THEN
        length(subject) > 0
        AND (unit IS NULL OR length(unit) > 0)
        AND test IS NULL AND result IS NULL
        AND (
          jsonb_typeof(value) = 'number'
          OR (jsonb_typeof(value) = 'string' AND length(value #>> '{}') > 0)
          OR (kind = 'trusted_fact' AND jsonb_typeof(value) = 'boolean')
        )
      WHEN category = 'evidence' AND kind = 'test_result' THEN
        length(test) > 0 AND length(result) > 0
        AND subject IS NULL AND value IS NULL AND unit IS NULL
      ELSE false
    END
  ) IS TRUE))
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'no invalid persisted provenance',
  CASE WHEN NOT EXISTS (SELECT 1 FROM public.session_items WHERE NOT ((
    jsonb_typeof(provenance) = 'object'
    AND CASE
      WHEN category = 'observation' THEN
        provenance = '{"actor":"user","method":"reported_observation"}'::jsonb
      WHEN category = 'hypothesis' THEN
        provenance IN (
          '{"actor":"user","method":"reported_claim"}'::jsonb,
          '{"actor":"model","method":"generated_hypothesis"}'::jsonb
        )
      WHEN category = 'evidence' AND kind = 'measurement' THEN
        provenance = '{"actor":"user","method":"reported_measurement"}'::jsonb
      WHEN category = 'evidence' AND kind = 'test_result' THEN
        provenance = '{"actor":"user","method":"reported_test_result"}'::jsonb
      WHEN category = 'evidence' AND kind = 'trusted_fact' THEN
        jsonb_typeof(provenance->'sourceId') = 'string'
        AND length(provenance->>'sourceId') BETWEEN 1 AND 200
        AND (provenance->>'sourceId') ~ '[^[:space:]]'
        AND provenance = jsonb_build_object(
          'actor', 'system', 'method', 'trusted_circuit_fact',
          'sourceId', provenance->>'sourceId'
        )
      ELSE false
    END
  ) IS TRUE))
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'persisted status matches eligible evidence types',
  CASE WHEN NOT EXISTS (
    SELECT 1 FROM public.session_items
    WHERE verification_status IS DISTINCT FROM CASE
      WHEN category = 'evidence' AND kind IN ('measurement', 'test_result', 'trusted_fact')
        THEN 'established' ELSE 'unverified' END
  ) THEN 'PASS' ELSE 'FAIL' END;
