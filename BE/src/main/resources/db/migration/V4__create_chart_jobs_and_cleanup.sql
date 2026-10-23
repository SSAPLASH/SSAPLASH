-- S15P31A307-97: 95번에서 합의한 시도 fencing·중복 접수·정리 재시도의 저장 기반.
-- 상태 전이, ACTIVE/소유권 확인, 임대 갱신 및 객체 삭제는 후속 서비스가 담당한다.
CREATE TABLE chart_jobs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    song_id bigint NOT NULL REFERENCES songs(id),
    user_id bigint NOT NULL REFERENCES users(id),
    status varchar(12) NOT NULL DEFAULT 'QUEUED'
        CHECK (status IN ('QUEUED', 'SEPARATING', 'TRANSCRIBING', 'DONE', 'FAILED')),
    progress smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    source_key varchar(300),
    drum_stem_key varchar(300),
    separation_model varchar(50),
    transcription_model varchar(50),
    metrics jsonb CHECK (jsonb_typeof(metrics) = 'object'),
    error_code varchar(50),
    error_message varchar(500),
    revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    current_attempt_id uuid,
    resume_stage varchar(12) NOT NULL DEFAULT 'SEPARATING'
        CHECK (resume_stage IN ('SEPARATING', 'TRANSCRIBING')),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    stage_deadline_at timestamptz,
    separation_retry_count integer NOT NULL DEFAULT 0 CHECK (separation_retry_count >= 0),
    transcription_retry_count integer NOT NULL DEFAULT 0 CHECK (transcription_retry_count >= 0),
    idempotency_key varchar(128) NOT NULL CHECK (btrim(idempotency_key) <> ''),
    request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    finished_at timestamptz,
    UNIQUE (user_id, idempotency_key),
    CHECK ((status IN ('DONE', 'FAILED')) = (finished_at IS NOT NULL)),
    CHECK (status <> 'DONE' OR progress = 100),
    CHECK (status NOT IN ('SEPARATING', 'TRANSCRIBING') OR current_attempt_id IS NOT NULL),
    CHECK (started_at IS NULL OR started_at >= created_at),
    CHECK (finished_at IS NULL OR finished_at >= created_at)
);

CREATE UNIQUE INDEX chart_jobs_user_active_idx ON chart_jobs (user_id)
    WHERE status IN ('QUEUED', 'SEPARATING', 'TRANSCRIBING');
CREATE INDEX chart_jobs_queue_idx ON chart_jobs (next_attempt_at, id) WHERE status = 'QUEUED';
CREATE INDEX chart_jobs_deadline_idx ON chart_jobs (stage_deadline_at)
    WHERE status IN ('SEPARATING', 'TRANSCRIBING');
CREATE INDEX chart_jobs_song_idx ON chart_jobs (song_id);

CREATE TABLE chart_job_attempts (
    id uuid PRIMARY KEY,
    job_id bigint NOT NULL REFERENCES chart_jobs(id),
    worker_id varchar(128) NOT NULL CHECK (btrim(worker_id) <> ''),
    claim_request_id uuid NOT NULL,
    lease_expires_at timestamptz NOT NULL,
    heartbeat_seq bigint NOT NULL DEFAULT 0 CHECK (heartbeat_seq >= 0),
    assigned_files jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(assigned_files) = 'array'),
    created_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    UNIQUE (worker_id, claim_request_id),
    UNIQUE (job_id, id),
    CHECK (lease_expires_at > created_at),
    CHECK (finished_at IS NULL OR finished_at >= created_at)
);
CREATE INDEX chart_job_attempts_lease_idx ON chart_job_attempts (lease_expires_at) WHERE finished_at IS NULL;

ALTER TABLE chart_jobs ADD CONSTRAINT chart_jobs_current_attempt_fk
    FOREIGN KEY (id, current_attempt_id) REFERENCES chart_job_attempts(job_id, id);

CREATE TABLE chart_job_results (
    result_id uuid PRIMARY KEY,
    job_id bigint NOT NULL REFERENCES chart_jobs(id),
    attempt_id uuid NOT NULL,
    stage varchar(12) NOT NULL CHECK (stage IN ('SEPARATING', 'TRANSCRIBING')),
    payload_hash varchar(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
    receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
    accepted_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (job_id, stage),
    FOREIGN KEY (job_id, attempt_id) REFERENCES chart_job_attempts(job_id, id)
);

-- 업로드 후 DB 접수 실패로 남은 객체도 job_id 없이 등록할 수 있다.
-- 인수한 결과/파일 키의 불변성 및 삭제 가능 여부는 서비스가 검사한다.
CREATE TABLE file_cleanup_tasks (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    object_key varchar(300) NOT NULL UNIQUE CHECK (btrim(object_key) <> ''),
    file_role varchar(30) NOT NULL CHECK (file_role IN
        ('SOURCE', 'DRUM_STEM', 'ACCOMPANIMENT', 'SHEET_PAGE', 'RAW_LOG', 'RECORDING', 'STAGING')),
    user_id bigint REFERENCES users(id),
    job_id bigint REFERENCES chart_jobs(id),
    attempt_id uuid,
    status varchar(10) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'DELETING', 'DELETED', 'FAILED')),
    retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    last_error varchar(500),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CHECK (attempt_id IS NULL OR job_id IS NOT NULL),
    FOREIGN KEY (job_id, attempt_id) REFERENCES chart_job_attempts(job_id, id),
    CHECK ((status = 'DELETED') = (deleted_at IS NOT NULL)),
    CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);
CREATE INDEX file_cleanup_tasks_retry_idx ON file_cleanup_tasks (next_attempt_at, id)
    WHERE status IN ('PENDING', 'FAILED', 'DELETING');
CREATE INDEX file_cleanup_tasks_user_idx ON file_cleanup_tasks (user_id);
CREATE INDEX file_cleanup_tasks_job_attempt_idx ON file_cleanup_tasks (job_id, attempt_id);
