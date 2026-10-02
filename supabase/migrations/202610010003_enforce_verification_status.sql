-- THL-002: authority is derived by the database, not declared by the model.
-- Existing rows remain valid: observations/hypotheses become unverified and
-- structured measurements/test results become established.

ALTER TABLE public.session_items
  DROP CONSTRAINT IF EXISTS session_items_category_kind_check;

ALTER TABLE public.session_items
  ADD CONSTRAINT session_items_category_kind_check
  CHECK (
    (category = 'observation' AND kind IS NULL)
    OR
    (category = 'hypothesis' AND kind IS NULL)
    OR
    (category = 'evidence' AND kind IN ('measurement', 'test_result', 'trusted_fact'))
  );

ALTER TABLE public.session_items
  ADD COLUMN verification_status text
  GENERATED ALWAYS AS (
    CASE
      WHEN category = 'evidence'
       AND kind IN ('measurement', 'test_result', 'trusted_fact')
        THEN 'established'
      ELSE 'unverified'
    END
  ) STORED;

ALTER TABLE public.session_items
  ADD CONSTRAINT session_items_provenance_authority_check
  CHECK (
    (
      category = 'observation'
      AND provenance->>'actor' = 'user'
      AND provenance->>'method' = 'reported_observation'
    )
    OR
    (
      category = 'hypothesis'
      AND (
        (
          provenance->>'actor' = 'user'
          AND provenance->>'method' = 'reported_claim'
        )
        OR
        (
          provenance->>'actor' = 'model'
          AND provenance->>'method' = 'generated_hypothesis'
        )
      )
    )
    OR
    (
      category = 'evidence'
      AND kind = 'measurement'
      AND provenance->>'actor' = 'user'
      AND provenance->>'method' = 'reported_measurement'
    )
    OR
    (
      category = 'evidence'
      AND kind = 'test_result'
      AND provenance->>'actor' = 'user'
      AND provenance->>'method' = 'reported_test_result'
    )
    OR
    (
      category = 'evidence'
      AND kind = 'trusted_fact'
      AND provenance->>'actor' = 'system'
      AND provenance->>'method' = 'trusted_circuit_fact'
      AND coalesce(length(trim(provenance->>'sourceId')), 0) > 0
    )
  );
