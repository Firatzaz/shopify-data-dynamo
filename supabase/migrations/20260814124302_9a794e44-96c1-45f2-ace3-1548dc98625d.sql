CREATE OR REPLACE FUNCTION public.event_log_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'event_log is append-only: % is not allowed', TG_OP;
END; $$;

REVOKE ALL ON FUNCTION public.event_log_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;