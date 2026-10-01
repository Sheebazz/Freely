CREATE TABLE public.turns (
  id uuid NOT NULL,
  session_id uuid NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT turns_pkey
    PRIMARY KEY (session_id, id),

  CONSTRAINT turns_session_fk
    FOREIGN KEY (session_id)
    REFERENCES public.sessions(id)
    ON DELETE CASCADE,

  CONSTRAINT turns_status_check
    CHECK (status IN ('processing', 'completed', 'failed'))
);

CREATE INDEX turns_session_id_idx
  ON public.turns (session_id);

ALTER TABLE public.turns ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE
ON TABLE public.turns
TO service_role;
