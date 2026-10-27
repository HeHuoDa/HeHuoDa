CREATE TABLE admin_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_salt bytea NOT NULL,
  password_hash bytea NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_operations (
  operation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type text NOT NULL CHECK (actor_type IN ('admin','maintenance','anonymous')),
  actor_id uuid,
  action text NOT NULL,
  object_type text NOT NULL,
  object_id text,
  reason text NOT NULL,
  result text NOT NULL CHECK (result IN ('success','failure')),
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((actor_type = 'admin' AND actor_id IS NOT NULL) OR (actor_type <> 'admin' AND actor_id IS NULL))
);
CREATE INDEX admin_operations_time_idx ON admin_operations(created_at DESC,operation_id DESC);

CREATE TABLE admin_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES admin_accounts(id),
  token_hash bytea NOT NULL UNIQUE,
  csrf_hash bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_sessions_account_idx ON admin_sessions(account_id);

-- A re-enabled account must log in again; old sessions never revive.
CREATE FUNCTION revoke_changed_admin_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.active AND NOT NEW.active) OR OLD.password_hash IS DISTINCT FROM NEW.password_hash OR OLD.password_salt IS DISTINCT FROM NEW.password_salt THEN
    UPDATE admin_sessions SET revoked_at=now() WHERE account_id=NEW.id AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER admin_account_credentials_changed AFTER UPDATE ON admin_accounts
FOR EACH ROW EXECUTE FUNCTION revoke_changed_admin_sessions();
