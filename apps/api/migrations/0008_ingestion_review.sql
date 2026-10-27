CREATE TABLE ingestion_review_revisions (
  candidate_id text NOT NULL REFERENCES ingestion_candidates(id),
  candidate_revision integer NOT NULL CHECK(candidate_revision > 1),
  source_version text NOT NULL REFERENCES ingestion_versions(id),
  target_id text NOT NULL,
  review jsonb NOT NULL,
  actor_id uuid NOT NULL REFERENCES admin_accounts(id),
  reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(candidate_id,candidate_revision)
);

CREATE TABLE ingestion_review_previews (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES admin_accounts(id),
  purpose text NOT NULL CHECK(purpose IN ('import','publish')),
  candidate_id text NOT NULL REFERENCES ingestion_candidates(id),
  source_version text NOT NULL REFERENCES ingestion_versions(id),
  candidate_revision integer NOT NULL CHECK(candidate_revision > 0),
  target_id text NOT NULL,
  baseline text NOT NULL,
  review_hash text NOT NULL,
  result jsonb NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ingestion_review_previews_candidate ON ingestion_review_previews(candidate_id,purpose,created_at DESC);

