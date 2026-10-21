-- S15P31A307-97: 생성 로직·파일 업로드 API는 각 기능 작업에서 구현한다.
CREATE TABLE reports (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    play_session_id uuid NOT NULL UNIQUE REFERENCES play_sessions(id) ON DELETE CASCADE,
    -- ERD는 내부 포맷을 확정하지 않았다. 상세 모양은 리포트 계약에서 검증한다.
    timing_histogram jsonb NOT NULL CHECK (jsonb_typeof(timing_histogram) IN ('object', 'array')),
    pad_stats jsonb NOT NULL CHECK (jsonb_typeof(pad_stats) IN ('object', 'array')),
    weak_segments jsonb CHECK (jsonb_typeof(weak_segments) = 'array'),
    recommended_drills jsonb CHECK (jsonb_typeof(recommended_drills) = 'array'),
    coach_text text,
    generator_version varchar(50) NOT NULL CHECK (btrim(generator_version) <> ''),
    generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recordings (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    play_session_id uuid UNIQUE REFERENCES play_sessions(id) ON DELETE SET NULL,
    title varchar(100) NOT NULL CHECK (btrim(title) <> ''),
    midi_key varchar(300) CHECK (btrim(midi_key) <> ''),
    audio_key varchar(300) CHECK (btrim(audio_key) <> ''),
    duration_ms integer CHECK (duration_ms >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);
CREATE INDEX recordings_user_created_idx ON recordings (user_id, created_at DESC);
