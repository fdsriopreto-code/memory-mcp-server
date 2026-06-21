-- Epistemic Status enum
DO $$ BEGIN
  CREATE TYPE epistemic_status AS ENUM ('HYPOTHESIS','VALIDATED','CONTESTED','DEPRECATED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- CAUSES in link_type enum
ALTER TYPE link_type ADD VALUE IF NOT EXISTS 'CAUSES';

-- Memory new columns
ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS epistemic_status epistemic_status NOT NULL DEFAULT 'HYPOTHESIS',
  ADD COLUMN IF NOT EXISTS drift_score FLOAT NOT NULL DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS validated_count INT NOT NULL DEFAULT 0;

-- MemoryLink confidence
ALTER TABLE memory_links
  ADD COLUMN IF NOT EXISTS confidence FLOAT NOT NULL DEFAULT 1.0;

-- MemoryAccessLog table
CREATE TABLE IF NOT EXISTS memory_access_logs (
  id VARCHAR(30) PRIMARY KEY,
  memory_id VARCHAR(30) NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  project_id VARCHAR(30) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL,
  hour_of_day INT NOT NULL,
  accessed_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_access_logs_memory ON memory_access_logs(memory_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_project ON memory_access_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_time ON memory_access_logs(day_of_week, hour_of_day);
