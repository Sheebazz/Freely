-- THL-002 final audit: match Node's nonblank sourceId rule for Unicode whitespace.
-- Existing invalid rows abort without deletion or relabelling.
BEGIN;
DO $audit$
DECLARE invalid_ids text;
BEGIN
  SELECT string_agg(id::text, ', ') INTO invalid_ids FROM (
    SELECT id FROM public.session_items
    WHERE kind = 'trusted_fact' AND NOT (((provenance->>'sourceId') ~ U&'[^\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]') IS TRUE)
    ORDER BY id LIMIT 20
  ) AS invalid;
  IF invalid_ids IS NOT NULL THEN
    RAISE EXCEPTION 'Existing trusted source IDs require explicit source-grounded repair; IDs: %', invalid_ids;
  END IF;
END;
$audit$;
ALTER TABLE public.session_items
  ADD CONSTRAINT session_items_trusted_source_nonblank_check
  CHECK ((CASE WHEN kind = 'trusted_fact' THEN
    (provenance->>'sourceId') ~ U&'[^\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]'
    ELSE true END) IS TRUE);
COMMIT;
