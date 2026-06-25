CREATE TABLE "memory_anchors" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "pattern" TEXT NOT NULL,
  "pattern_type" TEXT NOT NULL DEFAULT 'KEYWORD',
  "memory_ids" TEXT[] NOT NULL DEFAULT '{}',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 3,
  "hit_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memory_anchors_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "memory_anchors" ADD CONSTRAINT "memory_anchors_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
