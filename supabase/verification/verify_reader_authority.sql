-- Read-only post-006 checks; run alongside both earlier verifiers.
SELECT 'clarification constraint uses complete validator' AS check_name,
 CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.turns'::regclass
 AND conname='turns_completion_state_check' AND convalidated
 AND pg_get_constraintdef(oid) LIKE '%valid_turn_clarification%') THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL
SELECT 'no malformed finalized clarification rows',
 CASE WHEN NOT EXISTS (SELECT 1 FROM public.turns WHERE status='completed'
 AND completion_kind='clarification_required' AND NOT public.valid_turn_clarification(completion_payload)) THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'trusted fact type constraint validated',
 CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.session_items'::regclass
 AND conname='session_items_trusted_fact_type_check' AND convalidated) THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'RPC checks clarification before item inserts',
 CASE WHEN strpos(pg_get_functiondef('public.finalize_turn(uuid,uuid,jsonb,text,jsonb)'::regprocedure),
 'AND NOT public.valid_turn_clarification(p_completion_payload)') > 0
 AND strpos(pg_get_functiondef('public.finalize_turn(uuid,uuid,jsonb,text,jsonb)'::regprocedure),
 'AND NOT public.valid_turn_clarification(p_completion_payload)') < strpos(pg_get_functiondef('public.finalize_turn(uuid,uuid,jsonb,text,jsonb)'::regprocedure),
 'INSERT INTO public.session_items') THEN 'PASS' ELSE 'FAIL' END;
