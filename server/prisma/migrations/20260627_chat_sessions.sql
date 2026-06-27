-- Migration: add chat_sessions table for cross-device session persistence
CREATE TABLE IF NOT EXISTS chat_sessions (
  id           TEXT         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_slug TEXT         NOT NULL DEFAULT '__free__',
  project_name TEXT         NOT NULL DEFAULT 'Chat Livre',
  title        TEXT         NOT NULL DEFAULT 'Nova conversa',
  messages     JSONB        NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC);
