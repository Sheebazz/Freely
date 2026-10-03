-- User-described boards collect context only; no reviewed demo facts are inferred.
BEGIN;
ALTER TABLE public.sessions ADD COLUMN board_description text;
ALTER TABLE public.sessions ADD CONSTRAINT sessions_user_board_context_check
CHECK ((CASE WHEN circuit_id = 'user-board' THEN
  length(board_description) BETWEEN 1 AND 2000
  AND board_description ~ U&'[^\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]'
  ELSE board_description IS NULL END) IS TRUE);
COMMIT;
