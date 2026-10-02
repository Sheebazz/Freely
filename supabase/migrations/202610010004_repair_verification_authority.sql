-- THL-002 repair: reconcile the live legacy kind constraint and close
-- NULL/shape bypasses. Applied migration 003 remains unchanged.
-- No row is deleted, relabelled, or silently repaired. Invalid existing rows
-- make the transaction fail; inspect them before retrying.
BEGIN;

ALTER TABLE public.session_items
  DROP CONSTRAINT IF EXISTS session_items_kind_check,
  DROP CONSTRAINT session_items_category_kind_check,
  DROP CONSTRAINT session_items_provenance_authority_check;

ALTER TABLE public.session_items
  ADD CONSTRAINT session_items_category_kind_check
  CHECK (((category IN ('observation', 'hypothesis') AND kind IS NULL)
    OR (category = 'evidence' AND kind IN ('measurement', 'test_result', 'trusted_fact'))) IS TRUE),
  ADD CONSTRAINT session_items_structured_shape_check
  CHECK ((
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
  ) IS TRUE),
  ADD CONSTRAINT session_items_provenance_authority_check
  CHECK ((
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

COMMIT;
