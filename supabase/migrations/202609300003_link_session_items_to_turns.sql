ALTER TABLE public.session_items
  ADD CONSTRAINT session_items_turn_fk
  FOREIGN KEY (session_id, turn_id)
  REFERENCES public.turns (session_id, id)
  ON DELETE CASCADE;
