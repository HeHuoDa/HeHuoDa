CREATE TABLE ingestion_sources (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  settings jsonb NOT NULL DEFAULT '{"maxPages":10,"requests":80,"intervalMs":2000,"timeoutMs":15000,"durationMs":600000,"bytes":2097152,"frequencyMinutes":60}',
  last_started_at timestamptz
);
CREATE TABLE ingestion_runs (
  id text PRIMARY KEY,
  source_id text NOT NULL REFERENCES ingestion_sources(id),
  trigger text NOT NULL CHECK (trigger IN ('manual','scheduled','resume')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running','succeeded','partial','failed','interrupted')),
  options jsonb NOT NULL,
  cursor jsonb NOT NULL,
  counts jsonb NOT NULL,
  errors jsonb NOT NULL DEFAULT '[]'
);
CREATE TABLE ingestion_notices (
  id text PRIMARY KEY,
  source_id text NOT NULL REFERENCES ingestion_sources(id),
  url text NOT NULL,
  final_url text NOT NULL,
  latest_version text,
  fetched_at timestamptz NOT NULL,
  etag text,
  last_modified text,
  health text NOT NULL DEFAULT 'available',
  UNIQUE(source_id,url)
);
CREATE TABLE ingestion_versions (
  id text PRIMARY KEY,
  notice_id text NOT NULL REFERENCES ingestion_notices(id),
  previous_version text REFERENCES ingestion_versions(id),
  revision integer NOT NULL CHECK (revision > 0),
  body_hash text NOT NULL,
  adapter_version text NOT NULL,
  fetched_at timestamptz NOT NULL,
  article jsonb NOT NULL,
  extracted jsonb NOT NULL,
  raw_response bytea,
  response_headers jsonb NOT NULL,
  UNIQUE(notice_id,revision)
);
ALTER TABLE ingestion_notices ADD CONSTRAINT ingestion_latest_version_fk
  FOREIGN KEY(latest_version) REFERENCES ingestion_versions(id);
CREATE TABLE ingestion_candidates (
  id text PRIMARY KEY,
  notice_id text NOT NULL UNIQUE REFERENCES ingestion_notices(id),
  source_version text NOT NULL REFERENCES ingestion_versions(id),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('pending','approved','rejected','imported')),
  data jsonb NOT NULL,
  reviewer text,
  checked_at date,
  reason text,
  approved_file jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ingestion_mappings (
  candidate_id text PRIMARY KEY REFERENCES ingestion_candidates(id),
  competition_id text NOT NULL REFERENCES competitions(id),
  stage_ids jsonb NOT NULL,
  notice_ids jsonb NOT NULL,
  track_ids jsonb NOT NULL
);
CREATE TABLE ingestion_operations (
  id text PRIMARY KEY,
  candidate_id text NOT NULL REFERENCES ingestion_candidates(id),
  source_version text NOT NULL REFERENCES ingestion_versions(id),
  candidate_revision integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('approve','reject','reopen','preview','import','publish')),
  reviewer text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  input_hash text NOT NULL,
  result jsonb NOT NULL
);
CREATE INDEX ingestion_runs_source_status ON ingestion_runs(source_id,status);
CREATE INDEX ingestion_versions_fetched ON ingestion_versions(fetched_at) WHERE raw_response IS NOT NULL;
CREATE INDEX ingestion_candidates_status ON ingestion_candidates(status);
