-- Migration: notifications + day_states for proactive brain features
CREATE TABLE IF NOT EXISTS notifications (
  id           TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id   TEXT,
  type         TEXT        NOT NULL,
  title        TEXT        NOT NULL,
  body         TEXT        NOT NULL,
  memory_id    TEXT,
  is_read      BOOLEAN     NOT NULL DEFAULT false,
  is_dismissed BOOLEAN     NOT NULL DEFAULT false,
  metadata     JSONB       NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_unread ON notifications(is_dismissed, created_at DESC);

CREATE TABLE IF NOT EXISTS day_states (
  id         TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  date       TEXT        NOT NULL UNIQUE,
  focus      TEXT,
  energy     INTEGER,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
