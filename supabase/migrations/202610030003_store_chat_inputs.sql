-- Raw user messages are separate from diagnostic facts and accepted guidance.
BEGIN;
CREATE TABLE public.chat_inputs (
 turn_id uuid NOT NULL,
 session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
 message text NOT NULL CHECK (length(message) BETWEEN 1 AND 4000 AND btrim(message) <> ''),
 images jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(images) = 'array' AND jsonb_array_length(images) <= 1 AND octet_length(images::text) <= 701000),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(session_id, turn_id),
 FOREIGN KEY(session_id, turn_id) REFERENCES public.turns(session_id, id) ON DELETE CASCADE
);
ALTER TABLE public.chat_inputs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_inputs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.chat_inputs TO service_role;
CREATE FUNCTION public.save_chat_input(p_session_id uuid, p_turn_id uuid,
 p_request_hash text, p_message text, p_images jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_turn public.turns%ROWTYPE; v_input public.chat_inputs%ROWTYPE; v_image jsonb;
BEGIN
 SELECT * INTO v_turn FROM public.turns WHERE id=p_turn_id AND session_id=p_session_id FOR UPDATE;
 IF NOT FOUND OR v_turn.request_hash IS DISTINCT FROM p_request_hash OR v_turn.status <> 'processing' THEN
  RAISE EXCEPTION 'Chat input requires its matching processing turn';
 END IF;
 IF p_images IS NULL OR jsonb_typeof(p_images) <> 'array' THEN RAISE EXCEPTION 'Images must be an array'; END IF;
 FOR v_image IN SELECT value FROM jsonb_array_elements(p_images) LOOP
  IF (jsonb_typeof(v_image)='object' AND v_image = jsonb_build_object('mimeType',v_image->'mimeType','data',v_image->'data')
   AND v_image->>'mimeType'='image/jpeg' AND jsonb_typeof(v_image->'data')='string'
   AND length(v_image->>'data') BETWEEN 8 AND 700000
   AND v_image->>'data' ~ '^[A-Za-z0-9+/]+={0,2}$') IS NOT TRUE THEN
   RAISE EXCEPTION 'Invalid image envelope';
  END IF;
 END LOOP;
 SELECT * INTO v_input FROM public.chat_inputs WHERE turn_id=p_turn_id AND session_id=p_session_id;
 IF FOUND THEN
  IF v_input.session_id IS DISTINCT FROM p_session_id OR v_input.message IS DISTINCT FROM p_message OR v_input.images IS DISTINCT FROM p_images THEN
   RAISE EXCEPTION 'Chat input is immutable';
  END IF;
 ELSE
  INSERT INTO public.chat_inputs(turn_id,session_id,message,images) VALUES(p_turn_id,p_session_id,p_message,p_images);
 END IF;
END; $$;
REVOKE ALL ON FUNCTION public.save_chat_input(uuid,uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_chat_input(uuid,uuid,text,text,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
