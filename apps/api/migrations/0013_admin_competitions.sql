CREATE TABLE admin_competition_commands (
  actor_id uuid NOT NULL REFERENCES admin_accounts(id),
  operation_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('save','publish','hide')),
  input_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id, operation_id)
);

CREATE TABLE admin_competition_previews (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES admin_accounts(id),
  action text NOT NULL CHECK(action IN ('save','publish','hide')),
  target_id text NOT NULL,
  baseline text NOT NULL,
  command_hash text NOT NULL,
  changes jsonb NOT NULL,
  blocks jsonb NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_competition_previews_target ON admin_competition_previews(target_id,created_at DESC);
