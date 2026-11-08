-- AI 判定・照合ロジック（docs/AI_logic.md Phase 1）
-- 画像特徴量（image_embedding / pgvector）は Phase 2 で別 migration にする。

-- 近似色・カテゴリ全件フォールバック用の候補母集団検索
CREATE INDEX IF NOT EXISTS clothes_active_owner_category
  ON clothes (user_id, category)
  WHERE deleted_at IS NULL;

-- AI の初期提案。ユーザーが確定した既存列とは分離し、上書きしない
ALTER TABLE clothes ADD COLUMN IF NOT EXISTS ai_tags JSONB;
ALTER TABLE clothes ADD COLUMN IF NOT EXISTS ai_confidence JSONB;
ALTER TABLE clothes ADD COLUMN IF NOT EXISTS analyzed_at TIMESTAMPTZ;
ALTER TABLE clothes ADD COLUMN IF NOT EXISTS analysis_version TEXT;

ALTER TABLE wear_logs ADD COLUMN IF NOT EXISTS analysis_version TEXT;
ALTER TABLE wear_logs ADD COLUMN IF NOT EXISTS timezone TEXT;

-- 「AI が何位に出し、利用者が何を選んだか」を後から評価するための記録
ALTER TABLE wear_log_items ADD COLUMN IF NOT EXISTS candidate_rank SMALLINT;
ALTER TABLE wear_log_items ADD COLUMN IF NOT EXISTS candidate_reasons JSONB;

-- 個人化（最近着た・長く着ていない）の集計用
CREATE INDEX IF NOT EXISTS wear_log_items_clothes ON wear_log_items (clothes_id);
