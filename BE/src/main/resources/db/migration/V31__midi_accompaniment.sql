-- MIDI 원본 접수와 합성은 기존 AUDIO 채보 작업과 독립적으로 관리한다.
ALTER TABLE songs DROP CONSTRAINT songs_accompaniment_source_check;
ALTER TABLE songs ADD CONSTRAINT songs_accompaniment_source_check
    CHECK (accompaniment_key IS NULL OR source IN ('AUDIO', 'BUILTIN', 'MIDI'));

CREATE TABLE midi_original_uploads (
    id uuid PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id),
    reserved_song_id bigint NOT NULL UNIQUE,
    song_id bigint UNIQUE REFERENCES songs(id),
    object_key varchar(300) NOT NULL UNIQUE CHECK (object_key LIKE 'midi-original/%'),
    size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 1048576),
    sha256 varchar(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    status varchar(10) NOT NULL CHECK (status IN ('RECEIVING','ACCEPTED','RETIRED')),
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    retired_at timestamptz,
    CHECK ((status = 'ACCEPTED') = (song_id IS NOT NULL)),
    CHECK ((status = 'RETIRED') = (retired_at IS NOT NULL)),
    CHECK (song_id IS NULL OR song_id = reserved_song_id)
);
CREATE INDEX midi_original_receiving_idx ON midi_original_uploads(expires_at) WHERE status='RECEIVING';

CREATE TABLE midi_accompaniment_jobs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    song_id bigint NOT NULL REFERENCES songs(id),
    user_id bigint NOT NULL REFERENCES users(id),
    original_id uuid NOT NULL REFERENCES midi_original_uploads(id),
    timing jsonb NOT NULL CHECK (jsonb_typeof(timing) = 'object'),
    duration_ms integer NOT NULL CHECK (duration_ms BETWEEN 1 AND 1800000),
    status varchar(10) NOT NULL CHECK (status IN ('QUEUED','RUNNING','DONE','FAILED','CANCELLED')),
    attempt_id uuid,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
    lease_expires_at timestamptz,
    attempt_deadline_at timestamptz,
    next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    error_code varchar(50),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    finished_at timestamptz,
    CHECK ((status = 'RUNNING') = (attempt_id IS NOT NULL AND lease_expires_at IS NOT NULL AND attempt_deadline_at IS NOT NULL)),
    CHECK ((status IN ('DONE','FAILED','CANCELLED')) = (finished_at IS NOT NULL))
);
CREATE UNIQUE INDEX midi_jobs_active_song_idx ON midi_accompaniment_jobs(song_id) WHERE status IN ('QUEUED','RUNNING');
CREATE INDEX midi_jobs_queue_idx ON midi_accompaniment_jobs(next_attempt_at,id) WHERE status='QUEUED';
CREATE INDEX midi_jobs_song_latest_idx ON midi_accompaniment_jobs(song_id,id DESC);

CREATE TABLE midi_accompaniment_attempts (
    id uuid PRIMARY KEY,
    job_id bigint NOT NULL REFERENCES midi_accompaniment_jobs(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(job_id,id)
);

ALTER TABLE file_cleanup_tasks DROP CONSTRAINT file_cleanup_tasks_file_role_check;
ALTER TABLE file_cleanup_tasks ADD CONSTRAINT file_cleanup_tasks_file_role_check CHECK (file_role IN
    ('SOURCE','DRUM_STEM','ACCOMPANIMENT','SHEET_PAGE','RAW_LOG','RECORDING','STAGING','COVER','SHEET_MUSIC','MIDI_ORIGINAL'));
ALTER TABLE file_cleanup_tasks ADD COLUMN midi_original_id uuid REFERENCES midi_original_uploads(id);
ALTER TABLE file_cleanup_tasks ADD COLUMN midi_job_id bigint REFERENCES midi_accompaniment_jobs(id);
ALTER TABLE file_cleanup_tasks ADD COLUMN midi_attempt_id uuid;
ALTER TABLE file_cleanup_tasks ADD COLUMN midi_recheck_until timestamptz;
ALTER TABLE file_cleanup_tasks ADD CONSTRAINT file_cleanup_midi_attempt_fk
    FOREIGN KEY (midi_job_id,midi_attempt_id) REFERENCES midi_accompaniment_attempts(job_id,id);
ALTER TABLE file_cleanup_tasks ADD CONSTRAINT file_cleanup_midi_reference_check CHECK (
    (midi_job_id IS NULL) = (midi_attempt_id IS NULL) AND
    NOT (midi_original_id IS NOT NULL AND midi_job_id IS NOT NULL) AND
    ((midi_original_id IS NULL AND midi_job_id IS NULL) OR (job_id IS NULL AND attempt_id IS NULL)) AND
    (file_role <> 'MIDI_ORIGINAL' OR midi_original_id IS NOT NULL) AND
    (midi_original_id IS NULL OR file_role='MIDI_ORIGINAL') AND
    (midi_job_id IS NULL OR file_role='ACCOMPANIMENT')
);
