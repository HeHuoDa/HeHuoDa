CREATE INDEX ingestion_runs_resume_parent ON ingestion_runs ((options->>'resume'))
  WHERE options->>'resume' IS NOT NULL;
CREATE INDEX ingestion_runs_scheduled_time ON ingestion_runs(source_id,started_at,id)
  WHERE trigger='scheduled';
