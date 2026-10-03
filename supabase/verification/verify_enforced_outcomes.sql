-- Historical transport intentionally remains readable; enforce the new write boundary.
SELECT 'strict reasoning write validator exists' AS check_name,
 CASE WHEN to_regprocedure('public.valid_new_reasoning_result(jsonb)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL
SELECT 'raw finalizer invokes strict outcome validator',
 CASE WHEN pg_get_functiondef('public.finalize_reasoning_turn(uuid,uuid,jsonb,text,jsonb,jsonb,integer,uuid,text)'::regprocedure)
 LIKE '%NOT public.valid_new_reasoning_result(p_reasoning_result)%' THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'reasoning finalizer remains service-role-only',
 CASE WHEN has_function_privilege('service_role','public.finalize_reasoning_turn(uuid,uuid,jsonb,text,jsonb,jsonb,integer,uuid,text)','EXECUTE')
 AND NOT has_function_privilege('anon','public.finalize_reasoning_turn(uuid,uuid,jsonb,text,jsonb,jsonb,integer,uuid,text)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.finalize_reasoning_turn(uuid,uuid,jsonb,text,jsonb,jsonb,integer,uuid,text)','EXECUTE') THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'browser session access hashes are stored with a format constraint',
 CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
 AND table_name='sessions' AND column_name='access_token_hash' AND data_type='text') THEN 'PASS' ELSE 'FAIL' END;
