CREATE TABLE ingestion_rounds (
  id text PRIMARY KEY CHECK (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  due_at timestamptz NOT NULL,
  next_due_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running','partial','succeeded')),
  fresh_check_status jsonb NOT NULL DEFAULT '{}',
  rotation_cursor text,
  budget_usage jsonb NOT NULL DEFAULT '{}',
  CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at)
);

CREATE TABLE ingestion_channels (
  source_id text NOT NULL REFERENCES ingestion_sources(id),
  id text NOT NULL,
  data jsonb NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  settings jsonb NOT NULL DEFAULT '{}',
  verification_status text NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending','verified','rejected')),
  verification jsonb NOT NULL DEFAULT '{}',
  verified_at timestamptz,
  verified_by text,
  activated_on date,
  last_started_at timestamptz,
  last_successful_check timestamptz,
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  backoff_until timestamptz,
  rotation_seq bigint NOT NULL DEFAULT 0 CHECK (rotation_seq >= 0),
  PRIMARY KEY (source_id,id)
);

-- The migration runner executes once, so these rows are the only place where
-- legacy source state is copied into the default channel. Later static config
-- refreshes update data only and preserve operational state.
INSERT INTO ingestion_channels(source_id,id,data,enabled,settings,activated_on)
SELECT
  s.id,
  'default',
  COALESCE(
    (
      SELECT channel
      FROM jsonb_array_elements(COALESCE(s.data->'channels','[]'::jsonb)) AS channels(channel)
      WHERE channel->>'id' = COALESCE(s.data->>'defaultChannelId','default')
      LIMIT 1
    ),
    s.data
  ),
  s.enabled,
  '{}'::jsonb,
  CASE WHEN s.enabled THEN (now() AT TIME ZONE 'Asia/Shanghai')::date ELSE NULL END
FROM ingestion_sources AS s;

ALTER TABLE ingestion_runs
  ADD COLUMN channel_id text NOT NULL DEFAULT 'default',
  ADD COLUMN phase text CHECK (phase IS NULL OR phase IN ('fresh','backfill','revisit','retry')),
  ADD COLUMN config_hash text,
  ADD COLUMN task_id text,
  ADD COLUMN round_id text REFERENCES ingestion_rounds(id),
  ADD COLUMN budget_usage jsonb NOT NULL DEFAULT '{}';

ALTER TABLE ingestion_runs
  ADD CONSTRAINT ingestion_runs_source_channel_fk
    FOREIGN KEY (source_id,channel_id)
    REFERENCES ingestion_channels(source_id,id),
  ADD CONSTRAINT ingestion_runs_id_source_channel_key
    UNIQUE (id,source_id,channel_id);

ALTER TABLE ingestion_notices
  ADD CONSTRAINT ingestion_notices_id_source_key UNIQUE (id,source_id);

CREATE TABLE ingestion_notice_channels (
  notice_id text NOT NULL,
  source_id text NOT NULL,
  channel_id text NOT NULL,
  first_discovered_at timestamptz NOT NULL DEFAULT now(),
  last_discovered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notice_id,source_id,channel_id),
  FOREIGN KEY (notice_id,source_id)
    REFERENCES ingestion_notices(id,source_id) ON DELETE CASCADE,
  FOREIGN KEY (source_id,channel_id)
    REFERENCES ingestion_channels(source_id,id) ON DELETE CASCADE,
  CHECK (first_discovered_at <= last_discovered_at)
);

INSERT INTO ingestion_notice_channels(notice_id,source_id,channel_id,first_discovered_at,last_discovered_at)
SELECT n.id,n.source_id,'default',LEAST(n.fetched_at,COALESCE((SELECT min(v.fetched_at) FROM ingestion_versions v WHERE v.notice_id=n.id),n.fetched_at)),GREATEST(n.fetched_at,COALESCE((SELECT max(v.fetched_at) FROM ingestion_versions v WHERE v.notice_id=n.id),n.fetched_at)) FROM ingestion_notices n;

CREATE TABLE ingestion_scan_tasks (
  id text PRIMARY KEY CHECK (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  source_id text NOT NULL,
  channel_id text NOT NULL,
  round_id text REFERENCES ingestion_rounds(id),
  rebuild_of text UNIQUE REFERENCES ingestion_scan_tasks(id),
  phase text NOT NULL CHECK (phase IN ('fresh','backfill','revisit','retry')),
  from_date date NOT NULL,
  to_date date NOT NULL,
  config_hash text NOT NULL,
  cursor jsonb NOT NULL DEFAULT '{"pages":[],"pending":[],"seen":[]}',
  status text NOT NULL CHECK (status IN ('pending','running','partial','succeeded','failed','superseded')),
  leaf_run_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (source_id,channel_id)
    REFERENCES ingestion_channels(source_id,id),
  UNIQUE (id,source_id,channel_id),
  CHECK (from_date <= to_date)
);

-- Fresh checks are scoped to rounds and may accumulate one task per round.
-- Backfill, revisit, and retry work has one active resumable leaf per phase.
CREATE UNIQUE INDEX ingestion_scan_tasks_single_active_phase
  ON ingestion_scan_tasks(source_id,channel_id,phase)
  WHERE phase IN ('backfill','revisit','retry')
    AND status NOT IN ('succeeded','superseded');
CREATE UNIQUE INDEX ingestion_scan_tasks_single_fresh_round
  ON ingestion_scan_tasks(source_id,channel_id,round_id)
  WHERE phase='fresh' AND round_id IS NOT NULL
    AND status NOT IN ('succeeded','superseded');

ALTER TABLE ingestion_runs
  ADD CONSTRAINT ingestion_runs_task_scope_fk
    FOREIGN KEY (task_id,source_id,channel_id)
    REFERENCES ingestion_scan_tasks(id,source_id,channel_id);

ALTER TABLE ingestion_scan_tasks
  ADD CONSTRAINT ingestion_scan_tasks_leaf_run_scope_fk
    FOREIGN KEY (leaf_run_id,source_id,channel_id)
    REFERENCES ingestion_runs(id,source_id,channel_id);

CREATE INDEX ingestion_channels_enabled ON ingestion_channels(source_id,id)
  WHERE enabled;
CREATE INDEX ingestion_notice_channels_channel ON ingestion_notice_channels(source_id,channel_id,last_discovered_at DESC);
CREATE INDEX ingestion_scan_tasks_status ON ingestion_scan_tasks(status,updated_at,id);
CREATE INDEX ingestion_rounds_due ON ingestion_rounds(status,next_due_at,due_at);

-- Old application/CLI versions insert sources before runs and do not know the
-- channel table. Keep their default FK valid after an application rollback.
CREATE FUNCTION ingestion_seed_default_channel() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  default_id text := COALESCE(NEW.data->>'defaultChannelId','default');
  legacy_enabled boolean := NEW.enabled AND (NEW.id IN ('information-engineering','life-sciences'));
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.id IN ('information-engineering','life-sciences') AND (NEW.enabled IS DISTINCT FROM OLD.enabled OR NEW.settings IS DISTINCT FROM OLD.settings) THEN
      IF NEW.enabled AND EXISTS(SELECT 1 FROM ingestion_channels WHERE source_id=NEW.id AND id=default_id AND verification_status='rejected') THEN
        RAISE EXCEPTION '默认栏目核验已失效，须重新核验后启用';
      END IF;
      UPDATE ingestion_channels SET enabled=NEW.enabled,settings='{}'::jsonb,
        activated_on=CASE WHEN NEW.enabled AND NOT OLD.enabled THEN (now() AT TIME ZONE 'Asia/Shanghai')::date ELSE activated_on END
      WHERE source_id=NEW.id AND id=default_id;
    END IF;
    RETURN NEW;
  END IF;
  INSERT INTO ingestion_channels(source_id,id,data,enabled,settings,activated_on)
  VALUES(NEW.id,default_id,COALESCE((SELECT ch FROM jsonb_array_elements(COALESCE(NEW.data->'channels','[]'::jsonb)) ch WHERE ch->>'id'=default_id LIMIT 1),NEW.data),legacy_enabled,'{}'::jsonb,CASE WHEN legacy_enabled THEN (now() AT TIME ZONE 'Asia/Shanghai')::date ELSE NULL END)
  ON CONFLICT(source_id,id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ingestion_source_default_channel AFTER INSERT OR UPDATE OF enabled,settings ON ingestion_sources
  FOR EACH ROW EXECUTE FUNCTION ingestion_seed_default_channel();
