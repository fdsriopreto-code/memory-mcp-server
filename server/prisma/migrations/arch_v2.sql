-- HNSW index para busca semântica 10-100x mais rápida
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memories_embedding_hnsw
  ON memories USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Index básico para fallback se HNSW não disponível
CREATE INDEX IF NOT EXISTS idx_memories_project_type
  ON memories(project_id, type);

CREATE INDEX IF NOT EXISTS idx_memories_importance
  ON memories(project_id, importance DESC, access_count DESC);

-- MemoryAccessLog: index composto para brain_predict_context
CREATE INDEX IF NOT EXISTS idx_access_pattern
  ON memory_access_logs(project_id, day_of_week, hour_of_day, accessed_at DESC);

-- TTL: deletar logs com mais de 180 dias automaticamente
-- (será executado via cron no servidor)
-- Manualmente: DELETE FROM memory_access_logs WHERE accessed_at < NOW() - INTERVAL '180 days';

-- Memory version history
CREATE TABLE IF NOT EXISTS memory_versions (
  id VARCHAR(30) PRIMARY KEY,
  memory_id VARCHAR(30) NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  title TEXT NOT NULL,
  importance INT NOT NULL,
  changed_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  change_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_memory_versions_memory ON memory_versions(memory_id, changed_at DESC);

-- Token cost tracking in audit_logs
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS prompt_tokens INT,
  ADD COLUMN IF NOT EXISTS completion_tokens INT,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd FLOAT;
