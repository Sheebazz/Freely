-- Read-only pre-006 audit. Require both checks PASS. No automatic backfill.
WITH checked AS (
  SELECT id, (CASE
  WHEN jsonb_typeof(completion_payload) <> 'object' THEN false
  WHEN completion_payload->>'reason' = 'extraction_unrecoverable' THEN
    completion_payload = jsonb_build_object('reason', 'extraction_unrecoverable', 'detail', completion_payload->'detail')
    AND jsonb_typeof(completion_payload->'detail') = 'string'
    AND length(completion_payload->>'detail') BETWEEN 1 AND 1500
    AND (completion_payload->>'detail') ~ U&'[^\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]'
  WHEN completion_payload->>'reason' = 'semantic_ambiguity' THEN
    completion_payload = jsonb_build_object('reason', 'semantic_ambiguity', 'unresolved', completion_payload->'unresolved')
    AND CASE WHEN jsonb_typeof(completion_payload->'unresolved') = 'array' THEN
      jsonb_array_length(completion_payload->'unresolved') > 0
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(completion_payload->'unresolved') AS entries(entry)
        WHERE NOT ((
          jsonb_typeof(entry) = 'object'
          AND entry = jsonb_build_object('sourceText', entry->'sourceText', 'reason', entry->'reason')
          AND jsonb_typeof(entry->'sourceText') = 'string'
          AND jsonb_typeof(entry->'reason') = 'string'
          AND length(entry->>'sourceText') BETWEEN 1 AND 1000
          AND length(entry->>'reason') BETWEEN 1 AND 500
        ) IS TRUE)
      )
    ELSE false END
  ELSE false
END) IS TRUE AS readable
  FROM public.turns WHERE status = 'completed' AND completion_kind = 'clarification_required'
)
SELECT 'existing finalized clarification payloads readable' AS check_name,
  CASE WHEN NOT EXISTS (SELECT 1 FROM checked WHERE NOT readable) THEN 'PASS' ELSE 'FAIL' END AS result,
  COALESCE((SELECT jsonb_agg(id) FROM checked WHERE NOT readable), '[]'::jsonb) AS affected_ids
UNION ALL
SELECT 'no existing trusted facts awaiting source/type curation',
  CASE WHEN NOT EXISTS (SELECT 1 FROM public.session_items WHERE kind = 'trusted_fact') THEN 'PASS' ELSE 'FAIL' END,
  COALESCE((SELECT jsonb_agg(id) FROM public.session_items WHERE kind = 'trusted_fact'), '[]'::jsonb);
