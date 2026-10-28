CREATE TABLE ingestion_attachment_requests (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES admin_accounts(id),
  attachment_id uuid NOT NULL REFERENCES ingestion_attachments(id),
  version_id uuid REFERENCES ingestion_attachment_versions(id),
  operation_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('recheck','reparse')),
  expected_evidence_revision integer NOT NULL CHECK (expected_evidence_revision >= 0),
  reason text NOT NULL,
  status text NOT NULL CHECK (status IN ('accepted','running','completed','failed')),
  result jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (actor_id,operation_id),
  CHECK ((operation='reparse') = (version_id IS NOT NULL))
);

CREATE INDEX ingestion_attachment_requests_actor ON ingestion_attachment_requests(actor_id,created_at DESC);
CREATE INDEX ingestion_attachment_requests_pending ON ingestion_attachment_requests(created_at,id) WHERE status='accepted';
CREATE UNIQUE INDEX ingestion_attachment_requests_single_active ON ingestion_attachment_requests((true)) WHERE status IN ('accepted','running');

CREATE TABLE ingestion_network_windows (
  due_at timestamptz PRIMARY KEY,
  requests integer NOT NULL CHECK (requests BETWEEN 1 AND 200)
);
