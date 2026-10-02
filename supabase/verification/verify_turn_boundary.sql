-- Read-only post-005 checks. Run alongside verify_thl002.sql (24 checks).
SELECT 'turn completion constraint is validated and fail-closed' AS check_name,
 CASE WHEN EXISTS (SELECT 1 FROM pg_constraint
 WHERE conrelid='public.turns'::regclass AND conname='turns_completion_state_check'
 AND convalidated AND pg_get_constraintdef(oid) LIKE '%IS TRUE%')
 THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL
SELECT 'no invalid persisted turn completion metadata',
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
SELECT 'finalization explicitly rejects null completion kind',
 CASE WHEN pg_get_functiondef('public.finalize_turn(uuid,uuid,jsonb,text,jsonb)'::regprocedure)
 LIKE '%IF p_completion_kind IS NULL%'
 THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'finalization requires matching nonnull item session/turn IDs',
 CASE WHEN pg_get_functiondef('public.finalize_turn(uuid,uuid,jsonb,text,jsonb)'::regprocedure)
 LIKE '%(v_item->>''session_id'')::uuid IS DISTINCT FROM p_session_id%'
 AND pg_get_functiondef('public.finalize_turn(uuid,uuid,jsonb,text,jsonb)'::regprocedure)
 LIKE '%(v_item->>''turn_id'')::uuid IS DISTINCT FROM p_turn_id%'
 THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'runtime role has no table maintenance privilege',
 CASE WHEN NOT has_table_privilege('service_role','public.sessions','MAINTAIN')
 AND NOT has_table_privilege('service_role','public.turns','MAINTAIN')
 AND NOT has_table_privilege('service_role','public.session_items','MAINTAIN')
 THEN 'PASS' ELSE 'FAIL' END;
