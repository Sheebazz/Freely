-- Turn lifecycle mutations are backend-controlled operations.
-- A turn id is also bound to a request fingerprint so retries cannot silently
-- reuse a completed or in-progress turn for different input.

ALTER TABLE public.turns
  ADD COLUMN request_hash text;

ALTER TABLE public.turns
  ADD CONSTRAINT turns_request_hash_format_check
  CHECK (
    request_hash IS NULL
    OR request_hash ~ '^[0-9a-f]{64}$'
  );

-- Remove superseded lifecycle prototypes if an earlier development pass created them.
DROP FUNCTION IF EXISTS public.create_turn(uuid, uuid);
DROP FUNCTION IF EXISTS public.mark_turn_completed(uuid, uuid);
DROP FUNCTION IF EXISTS public.transition_turn(uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION public.create_turn(
  p_session_id uuid,
  p_turn_id uuid,
  p_request_hash text
)
RETURNS SETOF public.turns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_turn public.turns%ROWTYPE;
BEGIN
  IF p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Turn request hash must be a lowercase SHA-256 hex string';
  END IF;

  INSERT INTO public.turns (
    id,
    session_id,
    status,
    completion_kind,
    completion_payload,
    request_hash
  )
  VALUES (
    p_turn_id,
    p_session_id,
    'processing',
    NULL,
    NULL,
    p_request_hash
  )
  RETURNING * INTO v_turn;

  RETURN NEXT v_turn;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_turn_failed(
  p_session_id uuid,
  p_turn_id uuid
)
RETURNS SETOF public.turns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_turn public.turns%ROWTYPE;
BEGIN
  UPDATE public.turns
  SET status = 'failed',
      completion_kind = NULL,
      completion_payload = NULL,
      updated_at = now()
  WHERE session_id = p_session_id
    AND id = p_turn_id
    AND status = 'processing'
  RETURNING * INTO v_turn;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turn transition rejected: expected processing -> failed';
  END IF;

  RETURN NEXT v_turn;
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_failed_turn(
  p_session_id uuid,
  p_turn_id uuid
)
RETURNS SETOF public.turns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_turn public.turns%ROWTYPE;
BEGIN
  UPDATE public.turns
  SET status = 'processing',
      completion_kind = NULL,
      completion_payload = NULL,
      updated_at = now()
  WHERE session_id = p_session_id
    AND id = p_turn_id
    AND status = 'failed'
  RETURNING * INTO v_turn;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turn transition rejected: expected failed -> processing';
  END IF;

  RETURN NEXT v_turn;
END;
$$;

REVOKE ALL
ON FUNCTION public.create_turn(uuid, uuid, text)
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.mark_turn_failed(uuid, uuid)
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.retry_failed_turn(uuid, uuid)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.create_turn(uuid, uuid, text)
TO service_role;

GRANT EXECUTE
ON FUNCTION public.mark_turn_failed(uuid, uuid)
TO service_role;

GRANT EXECUTE
ON FUNCTION public.retry_failed_turn(uuid, uuid)
TO service_role;

-- Reads are allowed directly. Lifecycle mutations are function-owned.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.turns
FROM service_role;
