-- 워커에게 발급한 파일 ID와 검증된 체크포인트를 영속 보관한다.
CREATE TABLE chart_worker_files (
    id uuid PRIMARY KEY,
    job_id bigint NOT NULL REFERENCES chart_jobs(id),
    attempt_id uuid NOT NULL,
    role varchar(24) NOT NULL CHECK (role IN ('STAGING_DRUM', 'STAGING_ACCOMPANIMENT', 'DRUM_STEM', 'ACCOMPANIMENT')),
    object_key varchar(300) NOT NULL UNIQUE,
    content_type varchar(64) NOT NULL,
    size_bytes bigint CHECK (size_bytes > 0),
    sha256 varchar(64) CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (job_id, attempt_id) REFERENCES chart_job_attempts(job_id, id)
);
CREATE INDEX chart_worker_files_attempt_idx ON chart_worker_files(job_id, attempt_id);
CREATE UNIQUE INDEX chart_worker_files_staging_role_idx ON chart_worker_files(attempt_id, role)
    WHERE role IN ('STAGING_DRUM', 'STAGING_ACCOMPANIMENT');
ALTER TABLE chart_jobs ADD COLUMN separation_model_version varchar(128);
ALTER TABLE chart_jobs ADD COLUMN queued_at timestamptz NOT NULL DEFAULT now();
