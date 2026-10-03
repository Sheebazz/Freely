-- Read-only. Run once before 202610020002. Every row must PASS.
SELECT 'reasoning migration not already applied' AS check_name,
  CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='sessions' AND column_name='state_revision')
    THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL
SELECT 'THL-002 reader authority is present',
  CASE WHEN to_regprocedure('public.valid_turn_clarification(jsonb)') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.session_items'::regclass
      AND conname='session_items_trusted_source_nonblank_check' AND convalidated)
    THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'existing finalizer signature is present',
  CASE WHEN to_regprocedure('public.finalize_turn(uuid,uuid,jsonb,text,jsonb)') IS NOT NULL
    THEN 'PASS' ELSE 'FAIL' END;
