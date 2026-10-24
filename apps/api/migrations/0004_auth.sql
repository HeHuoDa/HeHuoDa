CREATE TABLE users (
 id text PRIMARY KEY, nickname text NOT NULL, status text NOT NULL DEFAULT 'active',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (status IN ('active','restricted','closing','deleted'))
);
CREATE TABLE wechat_identities (
 id text PRIMARY KEY, app_id text NOT NULL, open_id text NOT NULL, union_id text,
 user_id text NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT wechat_identities_app_open UNIQUE (app_id, open_id)
);
CREATE INDEX wechat_identities_user ON wechat_identities(user_id,id);
CREATE TABLE auth_sessions (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), absolute_expires_at timestamptz NOT NULL,
 revoked_at timestamptz, revoked_reason text
);
CREATE INDEX auth_sessions_user ON auth_sessions(user_id,id);
CREATE TABLE auth_tokens (
 id text PRIMARY KEY, session_id text NOT NULL REFERENCES auth_sessions(id), generation integer NOT NULL,
 access_hash text NOT NULL UNIQUE, access_expires_at timestamptz NOT NULL,
 refresh_hash text NOT NULL UNIQUE, refresh_expires_at timestamptz NOT NULL,
 consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT auth_tokens_session_generation UNIQUE (session_id, generation)
);
CREATE INDEX auth_tokens_session ON auth_tokens(session_id,generation);
CREATE TABLE auth_audit_logs (
 id text PRIMARY KEY, kind text NOT NULL, user_id text REFERENCES users(id), session_id text,
 request_id text NOT NULL, metadata jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_audit_logs_created ON auth_audit_logs(created_at);
CREATE TABLE auth_rate_limits (
 kind text NOT NULL, subject text NOT NULL, window_started_at timestamptz NOT NULL, count integer NOT NULL,
 PRIMARY KEY (kind,subject,window_started_at)
);
