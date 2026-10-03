-- Read-only. Run alongside the earlier verifiers. These are schema/data checks,
-- not proof of electronics reasoning quality or THL-004 outcome consistency.
SELECT 'reasoning finalizer exists' AS check_name,
  CASE WHEN to_regprocedure('public.finalize_reasoning_turn(uuid,uuid,jsonb,text,jsonb,jsonb,integer,uuid,text)') IS NOT NULL
    THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL
SELECT 'reasoning finalizer is service-role-only',
  CASE WHEN has_function_privilege('service_role', 'public.finalize_reasoning_turn(uuid,uuid,jsonb,text,jsonb,jsonb,integer,uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.finalize_reasoning_turn(uuid,uuid,jsonb,text,jsonb,jsonb,integer,uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.finalize_reasoning_turn(uuid,uuid,jsonb,text,jsonb,jsonb,integer,uuid,text)', 'EXECUTE')
    THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'readability and same-session reply constraints validated',
  CASE WHEN (SELECT count(*) FROM pg_constraint WHERE convalidated AND
    ((conrelid='public.turns'::regclass AND conname IN ('turns_reasoning_readable_check', 'turns_reply_same_session_fk'))
    OR (conrelid='public.session_items'::regclass AND conname='session_items_measurement_context_check'))) = 3
    THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'no unreadable saved reasoning or measurement context',
  CASE WHEN NOT EXISTS (SELECT 1 FROM public.turns WHERE reasoning_result IS NOT NULL
      AND NOT public.valid_reasoning_result(reasoning_result))
    AND NOT EXISTS (SELECT 1 FROM public.session_items WHERE measurement_context IS NOT NULL
      AND NOT public.valid_measurement_context(measurement_context))
    THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'saved recommendation origins belong to the measurement session',
  CASE WHEN NOT EXISTS (SELECT 1 FROM public.session_items item
    WHERE item.measurement_context->>'subjectOrigin'='recommended_test'
      AND NOT EXISTS (SELECT 1 FROM public.turns requested
        WHERE requested.session_id=item.session_id
        AND requested.id=(item.measurement_context->>'recommendationTurnId')::uuid
        AND requested.status='completed'
        AND requested.reasoning_result->'recommendation'->>'expectedResponseType'='measurement'
        AND requested.reasoning_result->'recommendation'->>'requestedSubject'=item.subject))
    THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'session revisions match their finalization records',
  CASE WHEN NOT EXISTS (SELECT 1 FROM public.sessions session
    WHERE session.state_revision IS DISTINCT FROM COALESCE((SELECT max(finalized_revision)
      FROM public.turns WHERE session_id=session.id), 0))
    THEN 'PASS' ELSE 'FAIL' END;
