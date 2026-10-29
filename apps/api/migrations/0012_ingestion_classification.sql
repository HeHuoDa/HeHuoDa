ALTER TABLE ingestion_candidates
  ADD COLUMN classification text NOT NULL DEFAULT 'suspected' CHECK (classification IN ('definite','suspected','non_competition')),
  ADD COLUMN rule_version text NOT NULL DEFAULT 'legacy',
  ADD COLUMN extraction_key text,
  ADD COLUMN classification_override text CHECK (classification_override IN ('definite','suspected','non_competition')),
  ADD COLUMN needs_review boolean NOT NULL DEFAULT true,
  ADD COLUMN priority integer NOT NULL DEFAULT 2 CHECK (priority BETWEEN 0 AND 3);

CREATE TABLE ingestion_extraction_revisions (
  id uuid PRIMARY KEY,
  candidate_id text NOT NULL REFERENCES ingestion_candidates(id),
  source_version text NOT NULL REFERENCES ingestion_versions(id),
  evidence_revision integer NOT NULL,
  rule_version text NOT NULL,
  extraction_key text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(candidate_id,extraction_key)
);
CREATE TABLE ingestion_classification_revisions (
  id uuid PRIMARY KEY,
  candidate_id text NOT NULL REFERENCES ingestion_candidates(id),
  candidate_revision integer NOT NULL,
  previous_classification text NOT NULL,
  classification text NOT NULL,
  reason text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  evidence_revision integer NOT NULL,
  baseline text NOT NULL,
  actor_id uuid NOT NULL REFERENCES admin_accounts(id)
);
CREATE INDEX ingestion_candidates_classification_queue ON ingestion_candidates(classification,priority,updated_at,id);
