CREATE TYPE public.plan_tier AS ENUM ('free', 'starter', 'pro', 'enterprise');

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan public.plan_tier NOT NULL DEFAULT 'free',
  store_limit integer NOT NULL DEFAULT 2,
  rule_limit integer NOT NULL DEFAULT 3,
  sync_events_monthly_limit integer NOT NULL DEFAULT 500,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

GRANT SELECT, INSERT, UPDATE ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscriptions_own" ON public.subscriptions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "subscriptions_own_ins" ON public.subscriptions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "subscriptions_own_upd" ON public.subscriptions FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE public.sync_rules ADD COLUMN IF NOT EXISTS conflict_resolution text NOT NULL DEFAULT 'source_wins';

ALTER TABLE public.snapshots ADD COLUMN IF NOT EXISTS archive_id uuid REFERENCES public.snapshot_archives(id) ON DELETE SET NULL;
ALTER TABLE public.snapshots ADD COLUMN IF NOT EXISTS name text;

CREATE INDEX IF NOT EXISTS event_log_user_status_created ON public.event_log (user_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.subscriptions (user_id, plan, store_limit, rule_limit, sync_events_monthly_limit, features)
  VALUES (NEW.id, 'free', 2, 3, 500, '{"restore": false, "approval_queue": true, "conflict_resolution": true, "charts": true}'::jsonb)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END; $$;