-- profiles
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  email text,
  full_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_own" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "profiles_own_upd" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_own_ins" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- stores
CREATE TABLE public.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  shopify_domain text NOT NULL,
  label text,
  access_token_encrypted text,
  scope text,
  role text NOT NULL DEFAULT 'secondary',
  status text NOT NULL DEFAULT 'pending',
  api_version text NOT NULL DEFAULT '2025-07',
  installed_at timestamptz,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, shopify_domain)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stores TO authenticated;
GRANT ALL ON public.stores TO service_role;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stores_own" ON public.stores FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "stores_ins" ON public.stores FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "stores_upd" ON public.stores FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "stores_del" ON public.stores FOR DELETE TO authenticated USING (user_id = auth.uid());

-- sync_rules
CREATE TABLE public.sync_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  source_store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  destination_store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  field_toggles jsonb NOT NULL DEFAULT '{"inventory":true,"price":false,"title":false,"description":false,"images":false}'::jsonb,
  buffer_quantity integer NOT NULL DEFAULT 0,
  dry_run boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sync_rules_distinct_stores CHECK (source_store_id <> destination_store_id),
  UNIQUE (source_store_id, destination_store_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_rules TO authenticated;
GRANT ALL ON public.sync_rules TO service_role;
ALTER TABLE public.sync_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rules_own" ON public.sync_rules FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "rules_ins" ON public.sync_rules FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "rules_upd" ON public.sync_rules FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "rules_del" ON public.sync_rules FOR DELETE TO authenticated USING (user_id = auth.uid());

-- event_log (append-only)
CREATE TABLE public.event_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  origin_store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  webhook_id text,
  entity_type text NOT NULL,
  entity_id text,
  sku text,
  field text,
  old_value text,
  new_value text,
  source text NOT NULL,
  status text NOT NULL DEFAULT 'applied',
  dry_run boolean NOT NULL DEFAULT false,
  message text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX event_log_webhook_unique ON public.event_log (webhook_id, field) WHERE webhook_id IS NOT NULL;
CREATE INDEX event_log_user_created ON public.event_log (user_id, created_at DESC);
GRANT SELECT, INSERT ON public.event_log TO authenticated;
GRANT SELECT, INSERT ON public.event_log TO service_role;
ALTER TABLE public.event_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "events_own" ON public.event_log FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "events_ins" ON public.event_log FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.event_log_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'event_log is append-only: % is not allowed', TG_OP;
END; $$;
CREATE TRIGGER event_log_no_update BEFORE UPDATE ON public.event_log
FOR EACH ROW EXECUTE FUNCTION public.event_log_append_only();
CREATE TRIGGER event_log_no_delete BEFORE DELETE ON public.event_log
FOR EACH ROW EXECUTE FUNCTION public.event_log_append_only();

-- sync_queue
CREATE TABLE public.sync_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users ON DELETE CASCADE,
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE,
  webhook_topic text NOT NULL,
  webhook_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE UNIQUE INDEX sync_queue_webhook_unique ON public.sync_queue (webhook_id) WHERE webhook_id IS NOT NULL;
CREATE INDEX sync_queue_status ON public.sync_queue (status, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_queue TO authenticated;
GRANT ALL ON public.sync_queue TO service_role;
ALTER TABLE public.sync_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "queue_own" ON public.sync_queue FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "queue_ins" ON public.sync_queue FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "queue_upd" ON public.sync_queue FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- snapshots
CREATE TABLE public.snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE,
  taken_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  event_log_range_start timestamptz,
  event_log_range_end timestamptz
);
GRANT SELECT, INSERT, DELETE ON public.snapshots TO authenticated;
GRANT ALL ON public.snapshots TO service_role;
ALTER TABLE public.snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "snap_own" ON public.snapshots FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "snap_ins" ON public.snapshots FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE TABLE public.snapshot_archives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE,
  taken_at timestamptz NOT NULL DEFAULT now(),
  source text,
  full_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  checksum text,
  is_verified boolean NOT NULL DEFAULT false
);
GRANT SELECT, INSERT ON public.snapshot_archives TO authenticated;
GRANT ALL ON public.snapshot_archives TO service_role;
ALTER TABLE public.snapshot_archives ENABLE ROW LEVEL SECURITY;
CREATE POLICY "arch_own" ON public.snapshot_archives FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "arch_ins" ON public.snapshot_archives FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- oauth_states (server-only)
CREATE TABLE public.oauth_states (
  state text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  shopify_domain text NOT NULL,
  label text,
  role text NOT NULL DEFAULT 'secondary',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.oauth_states TO service_role;
ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;