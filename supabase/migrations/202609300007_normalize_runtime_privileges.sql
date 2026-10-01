-- Make the runtime database boundary explicit and reproducible.
-- Browser-facing roles do not access THL-001 persistence tables directly.
-- service_role keeps only the table privileges used by the Node backend;
-- controlled functions own turn/session-item mutations.

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turns ENABLE ROW LEVEL SECURITY;

REVOKE ALL
ON TABLE public.sessions, public.session_items, public.turns
FROM anon, authenticated;

GRANT SELECT, INSERT, DELETE
ON TABLE public.sessions
TO service_role;

REVOKE UPDATE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.sessions
FROM service_role;

GRANT SELECT
ON TABLE public.session_items
TO service_role;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.session_items
FROM service_role;

GRANT SELECT
ON TABLE public.turns
TO service_role;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.turns
FROM service_role;
