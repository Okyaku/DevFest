CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  avatar_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE clothes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('tops','bottoms','outer','dress','shoes')),
  sub_category TEXT,
  color TEXT NOT NULL,
  sleeve_length TEXT,
  hem_length TEXT,
  seasons TEXT[] NOT NULL DEFAULT '{}',
  scene TEXT,
  image_key TEXT,
  name TEXT,
  notes TEXT,
  category_color TEXT NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX clothes_owner_category_color ON clothes(user_id, category_color) WHERE deleted_at IS NULL;

CREATE TABLE wear_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date DATE NOT NULL,
  selfie_key TEXT,
  selections JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX wear_logs_owner_date ON wear_logs(user_id, local_date);

CREATE TABLE wear_log_items (
  wear_log_id UUID NOT NULL REFERENCES wear_logs(id) ON DELETE CASCADE,
  clothes_id UUID NOT NULL REFERENCES clothes(id),
  detected_slot TEXT,
  candidate_score SMALLINT,
  PRIMARY KEY (wear_log_id, clothes_id)
);
