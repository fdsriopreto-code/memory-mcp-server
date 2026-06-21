-- Brain Module Migration
-- Aplicar no banco de dados do MCP server

-- 1. Adicionar campo is_pinned na tabela memories
ALTER TABLE memories ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false;

-- 2. Adicionar valor BRAIN ao enum memory_type
-- (não pode usar IF NOT EXISTS diretamente no ALTER TYPE, mas é idempotente via DO block)
DO $$ BEGIN
  ALTER TYPE memory_type ADD VALUE 'BRAIN';
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 3. Criar enum link_type
DO $$ BEGIN
  CREATE TYPE link_type AS ENUM ('EXTENDS', 'SUPERSEDES', 'CONTRADICTS', 'DEPENDS_ON', 'EXAMPLE_OF', 'RELATED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 4. Criar tabela memory_links
CREATE TABLE IF NOT EXISTS memory_links (
  id         TEXT        NOT NULL,
  from_id    TEXT        NOT NULL,
  to_id      TEXT        NOT NULL,
  relation   link_type   NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT memory_links_pkey PRIMARY KEY (id),
  CONSTRAINT memory_links_from_id_to_id_relation_key UNIQUE (from_id, to_id, relation),
  CONSTRAINT memory_links_from_id_fkey FOREIGN KEY (from_id) REFERENCES memories(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT memory_links_to_id_fkey   FOREIGN KEY (to_id)   REFERENCES memories(id) ON DELETE CASCADE ON UPDATE CASCADE
);
