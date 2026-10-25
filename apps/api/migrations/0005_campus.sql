CREATE TABLE campus_bindings (
 user_id text NOT NULL REFERENCES users(id), source text NOT NULL,
 subject_hmac text NOT NULL, created_at timestamptz NOT NULL,
 PRIMARY KEY (user_id, source), UNIQUE (source, subject_hmac)
);
CREATE TABLE campus_qualifications (
 user_id text PRIMARY KEY REFERENCES users(id), source text NOT NULL,
 term_id text NOT NULL, verified_at timestamptz NOT NULL,
 valid_until timestamptz NOT NULL, revoked_at timestamptz
);
CREATE TABLE campus_profiles (
 user_id text PRIMARY KEY REFERENCES users(id), source text NOT NULL,
 ciphertext text NOT NULL, nonce text NOT NULL, tag text NOT NULL,
 key_id text NOT NULL, version integer NOT NULL, updated_at timestamptz NOT NULL
);
CREATE TABLE campus_transactions (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id),
 session_id text NOT NULL, instance_id text NOT NULL, term_id text NOT NULL,
 status text NOT NULL CHECK (status IN ('waiting','processing','succeeded','failed','cancelled','expired')),
 operation text, challenge_version text, reason text, qualification jsonb,
 created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, finished_at timestamptz
);
CREATE UNIQUE INDEX campus_one_active_user ON campus_transactions(user_id) WHERE status IN ('waiting','processing');
CREATE INDEX campus_transactions_retention ON campus_transactions(finished_at);
CREATE TABLE campus_audit_logs (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id),
 request_id text NOT NULL, kind text NOT NULL, reason text,
 created_at timestamptz NOT NULL
);
CREATE INDEX campus_audit_retention ON campus_audit_logs(created_at);
CREATE TABLE campus_rate_budgets (
 id text PRIMARY KEY, events jsonb NOT NULL, updated_at timestamptz NOT NULL
);
