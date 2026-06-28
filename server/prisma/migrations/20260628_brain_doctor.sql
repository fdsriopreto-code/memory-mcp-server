-- Brain Doctor: tabelas de runs e configuração

CREATE TABLE IF NOT EXISTS "brain_doctor_runs" (
  "id"           TEXT        NOT NULL,
  "project_slug" TEXT        NOT NULL,
  "model"        TEXT        NOT NULL,
  "status"       TEXT        NOT NULL DEFAULT 'running',
  "goal"         TEXT,
  "plan"         JSONB,
  "steps"        JSONB       NOT NULL DEFAULT '[]',
  "stats"        JSONB       NOT NULL DEFAULT '{}',
  "summary"      TEXT,
  "error"        TEXT,
  "started_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "completed_at" TIMESTAMPTZ,
  PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_brain_doctor_runs_project" ON "brain_doctor_runs"("project_slug");
CREATE INDEX IF NOT EXISTS "idx_brain_doctor_runs_status"  ON "brain_doctor_runs"("status");

CREATE TABLE IF NOT EXISTS "brain_doctor_configs" (
  "id"         TEXT        NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "enabled"    BOOLEAN     NOT NULL DEFAULT FALSE,
  "frequency"  TEXT        NOT NULL DEFAULT 'weekly',
  "model"      TEXT        NOT NULL DEFAULT 'gpt-4o',
  "projects"   TEXT[]      NOT NULL DEFAULT '{}',
  "hour"       INTEGER     NOT NULL DEFAULT 3,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("id")
);

-- Insert singleton config row if not present
INSERT INTO "brain_doctor_configs" ("enabled","frequency","model","projects","hour","updated_at")
SELECT FALSE, 'weekly', 'gpt-4o', '{}', 3, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "brain_doctor_configs");
