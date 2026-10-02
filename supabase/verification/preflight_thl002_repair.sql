-- Read-only preflight for repair 004, AFTER migration 003.
-- Every check must PASS before applying 004. Diagnostics below identify
-- invalid rows without changing them. Do not rerun migration 003.
SELECT 'THL-002 generated status exists' AS check_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'session_items'
      AND column_name = 'verification_status' AND is_generated = 'ALWAYS'
  ) THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL
SELECT 'repair 004 not already applied',
  CASE WHEN NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.session_items'::regclass
      AND conname = 'session_items_structured_shape_check'
  ) THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'existing category/kind compatible',
  CASE WHEN NOT EXISTS (SELECT 1 FROM public.session_items WHERE NOT (((category IN ('observation', 'hypothesis') AND kind IS NULL)
    OR (category = 'evidence' AND kind IN ('measurement', 'test_result', 'trusted_fact'))) IS TRUE))
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'existing structured shapes compatible',
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
SELECT 'existing provenance compatible',
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
  THEN 'PASS' ELSE 'FAIL' END;

SELECT id, session_id, category, kind
FROM public.session_items
WHERE NOT (((category IN ('observation', 'hypothesis') AND kind IS NULL)
    OR (category = 'evidence' AND kind IN ('measurement', 'test_result', 'trusted_fact'))) IS TRUE) OR NOT ((
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
  ) IS TRUE) OR NOT ((
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
  ) IS TRUE);
