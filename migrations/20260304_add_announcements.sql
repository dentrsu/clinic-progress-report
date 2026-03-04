-- Add announcements table
-- Admins can post system-wide messages shown on landing.html for specific audiences.

-- Ensure the shared updated_at helper exists (idempotent)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS public.announcements (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  title           text        NOT NULL,
  content         text        NOT NULL,
  target_audience text        NOT NULL DEFAULT 'both',
  is_active       boolean     NOT NULL DEFAULT false,
  start_date      timestamptz,
  end_date        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT announcements_pkey PRIMARY KEY (id),
  CONSTRAINT announcements_target_audience_check
    CHECK (target_audience IN ('student', 'instructor', 'both'))
);

-- Auto-update updated_at on any row change
CREATE OR REPLACE TRIGGER set_announcements_updated_at
  BEFORE UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
