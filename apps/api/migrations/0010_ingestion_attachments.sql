ALTER TABLE ingestion_notices
  ADD COLUMN evidence_revision integer NOT NULL DEFAULT 1 CHECK (evidence_revision > 0),
  ADD COLUMN evidence_state text NOT NULL DEFAULT 'current'
    CHECK (evidence_state IN ('current','review-required','blocked'));

CREATE TABLE ingestion_attachments (
  id uuid PRIMARY KEY,
  notice_id text NOT NULL REFERENCES ingestion_notices(id) ON DELETE CASCADE,
  canonical_url text NOT NULL,
  discovered_version text NOT NULL REFERENCES ingestion_versions(id),
  latest_version uuid,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','extracted','needs-review','blocked','failed','stale')),
  last_checked_at timestamptz,
  error_code text,
  UNIQUE (notice_id, canonical_url),
  UNIQUE (id, notice_id)
);

CREATE TABLE ingestion_attachment_versions (
  id uuid PRIMARY KEY,
  attachment_id uuid NOT NULL REFERENCES ingestion_attachments(id) ON DELETE CASCADE,
  previous_version uuid REFERENCES ingestion_attachment_versions(id),
  revision integer NOT NULL CHECK (revision > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  fetched_at timestamptz NOT NULL,
  media_type text NOT NULL,
  extractor_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('extracted','needs-review','blocked','failed')),
  segments jsonb NOT NULL DEFAULT '[]',
  error_code text,
  body bytea,
  UNIQUE (attachment_id, revision),
  UNIQUE (id, attachment_id)
);

ALTER TABLE ingestion_attachments
  ADD CONSTRAINT ingestion_attachments_latest_version_fk
  FOREIGN KEY (latest_version, id)
  REFERENCES ingestion_attachment_versions(id, attachment_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE ingestion_evidence_sets (
  notice_id text NOT NULL REFERENCES ingestion_notices(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  source_version text NOT NULL REFERENCES ingestion_versions(id),
  attachment_versions jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('current','review-required','blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notice_id, revision)
);
CREATE INDEX ingestion_attachments_recheck ON ingestion_attachments(last_checked_at, id)
  WHERE state <> 'blocked';
CREATE INDEX ingestion_attachment_versions_cleanup ON ingestion_attachment_versions(fetched_at)
  WHERE body IS NOT NULL;

CREATE TABLE ingestion_attachment_events (
  id uuid PRIMARY KEY,
  notice_id text NOT NULL REFERENCES ingestion_notices(id),
  source_version text NOT NULL REFERENCES ingestion_versions(id),
  evidence_revision integer NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
