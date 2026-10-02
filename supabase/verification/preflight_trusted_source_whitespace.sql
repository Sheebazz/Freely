-- Read-only before the 2 October sourceId repair. Require PASS and [].
SELECT 'trusted source IDs satisfy Node nonblank rule' AS check_name,
  CASE WHEN NOT EXISTS (SELECT 1 FROM public.session_items
    WHERE kind='trusted_fact' AND NOT (((provenance->>'sourceId') ~ U&'[^\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]') IS TRUE)) THEN 'PASS' ELSE 'FAIL' END AS result,
  COALESCE((SELECT jsonb_agg(id) FROM public.session_items
    WHERE kind='trusted_fact' AND NOT (((provenance->>'sourceId') ~ U&'[^\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]') IS TRUE)), '[]'::jsonb) AS affected_ids;
