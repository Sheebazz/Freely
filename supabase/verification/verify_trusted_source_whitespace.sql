-- Read-only after the 2 October repair. Both rows must PASS.
SELECT 'trusted source nonblank constraint validated' AS check_name,
  CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.session_items'::regclass
    AND conname='session_items_trusted_source_nonblank_check' AND convalidated)
    THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL
SELECT 'no incompatible trusted source IDs',
  CASE WHEN NOT EXISTS (SELECT 1 FROM public.session_items
    WHERE kind='trusted_fact' AND NOT (((provenance->>'sourceId') ~ U&'[^\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]') IS TRUE)) THEN 'PASS' ELSE 'FAIL' END;
