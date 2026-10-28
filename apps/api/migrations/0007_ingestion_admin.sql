ALTER TABLE admin_operations ADD COLUMN command_operation_id uuid;
CREATE INDEX admin_operations_command ON admin_operations(command_operation_id) WHERE command_operation_id IS NOT NULL;

CREATE TABLE admin_ingestion_commands (
  actor_id uuid NOT NULL REFERENCES admin_accounts(id),
  operation_id uuid NOT NULL,
  action text NOT NULL,
  input_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id, operation_id)
);

CREATE TABLE ingestion_requests (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES admin_accounts(id),
  source_id text NOT NULL,
  status text NOT NULL CHECK(status IN ('accepted','running','completed','failed','interrupted')),
  options jsonb NOT NULL,
  run_id text REFERENCES ingestion_runs(id),
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);
CREATE INDEX ingestion_requests_pending ON ingestion_requests(status, created_at, id);
CREATE UNIQUE INDEX ingestion_requests_single_active ON ingestion_requests((true)) WHERE status IN ('accepted','running');
