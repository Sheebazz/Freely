-- Read-only after the uncertainty-basis repair. Both checks must PASS.
SELECT 'new uncertainty origins are required at finalization' AS check_name,
 CASE WHEN strpos(pg_get_functiondef('public.finalize_reasoning_turn(uuid,uuid,jsonb,text,jsonb,jsonb,integer,uuid,text)'::regprocedure),
 'Unestablished cause requires an explicit uncertainty basis') > 0 THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL
SELECT 'persisted uncertainty origins are readable',
 CASE WHEN NOT EXISTS (SELECT 1 FROM public.turns WHERE reasoning_result IS NOT NULL
 AND NOT public.valid_reasoning_result(reasoning_result)) THEN 'PASS' ELSE 'FAIL' END;
