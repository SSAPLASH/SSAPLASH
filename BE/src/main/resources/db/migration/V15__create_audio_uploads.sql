-- S15P31A307-159: PUT 이전 기록은 프로세스 중단 후에도 정리 근거로 남긴다.
CREATE TABLE audio_uploads (
    id uuid PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id),
    job_id bigint REFERENCES chart_jobs(id),
    object_key varchar(300) NOT NULL UNIQUE CHECK (object_key LIKE 'source-audio/%'),
    content_type varchar(32) NOT NULL CHECK (content_type IN ('audio/mpeg','audio/wav')),
    size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 52428800),
    sha256 varchar(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    duration_ms integer NOT NULL CHECK (duration_ms > 0 AND duration_ms <= 600000),
    status varchar(10) NOT NULL CHECK (status IN ('UPLOADING','ACCEPTED','RETIRED')),
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    retired_at timestamptz,
    CHECK ((status = 'ACCEPTED') = (job_id IS NOT NULL)),
    CHECK ((status = 'RETIRED') = (retired_at IS NOT NULL)),
    CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX audio_uploads_job_accepted_idx ON audio_uploads(job_id) WHERE status='ACCEPTED';
CREATE INDEX audio_uploads_expiry_idx ON audio_uploads(expires_at,id) WHERE status='UPLOADING';
CREATE INDEX file_cleanup_source_recheck_idx ON file_cleanup_tasks(next_attempt_at,id) WHERE file_role='SOURCE' AND status='DELETED';
