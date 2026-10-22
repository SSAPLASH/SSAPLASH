-- S15P31A307-98: 접수 기록은 세션 삭제 뒤에도 고아 객체 정리 근거로 남긴다.
CREATE TABLE play_raw_uploads (
    id uuid PRIMARY KEY,
    original_play_id uuid NOT NULL,
    play_session_id uuid REFERENCES play_sessions(id) ON DELETE SET NULL,
    object_key varchar(300) NOT NULL UNIQUE CHECK (object_key LIKE 'play-raw/%'),
    payload_hash varchar(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
    payload_bytes bigint NOT NULL CHECK (payload_bytes > 0 AND payload_bytes <= 67108864),
    status varchar(10) NOT NULL CHECK (status IN ('UPLOADING', 'ACCEPTED', 'RETIRED')),
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    retired_at timestamptz,
    CHECK (play_session_id IS NULL OR play_session_id = original_play_id),
    CHECK ((status = 'RETIRED') = (retired_at IS NOT NULL)),
    CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX play_raw_one_accepted_idx ON play_raw_uploads(play_session_id)
    WHERE status = 'ACCEPTED' AND play_session_id IS NOT NULL;
CREATE INDEX play_raw_session_idx ON play_raw_uploads(play_session_id);
CREATE INDEX play_raw_expiry_idx ON play_raw_uploads(expires_at, id) WHERE status = 'UPLOADING';
CREATE INDEX play_raw_orphan_idx ON play_raw_uploads(id)
    WHERE play_session_id IS NULL AND status <> 'RETIRED';
CREATE INDEX file_cleanup_raw_recheck_idx ON file_cleanup_tasks(next_attempt_at, id)
    WHERE file_role = 'RAW_LOG' AND status = 'DELETED';
