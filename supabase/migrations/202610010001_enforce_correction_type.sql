-- Corrections may replace an item only within the same persisted type.
-- This closes promotion/reclassification paths around the session-state boundary.

CREATE OR REPLACE FUNCTION public.enforce_session_item_correction_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target_category text;
  v_target_kind text;
BEGIN
  IF NEW.supersedes_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT category, kind
  INTO v_target_category, v_target_kind
  FROM public.session_items
  WHERE id = NEW.supersedes_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Correction target does not exist';
  END IF;

  IF v_target_category IS DISTINCT FROM NEW.category
     OR v_target_kind IS DISTINCT FROM NEW.kind THEN
    RAISE EXCEPTION
      'Correction cannot change item category or evidence kind';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL
ON FUNCTION public.enforce_session_item_correction_type()
FROM PUBLIC;

DROP TRIGGER IF EXISTS session_items_correction_type_guard
ON public.session_items;

CREATE TRIGGER session_items_correction_type_guard
BEFORE INSERT ON public.session_items
FOR EACH ROW
WHEN (NEW.supersedes_id IS NOT NULL)
EXECUTE FUNCTION public.enforce_session_item_correction_type();
