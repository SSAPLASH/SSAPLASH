-- S15P31A307-97: MISS도 hits 행으로 보관한다. note_results는 만들지 않는다.
CREATE TABLE play_sessions (
    id uuid PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id),
    song_id bigint REFERENCES songs(id),
    chart_version_id bigint REFERENCES chart_versions(id),
    mode varchar(6) NOT NULL CHECK (mode IN ('RHYTHM', 'FREE', 'TEMPO', 'SHEET')),
    input_source varchar(10) NOT NULL CHECK (input_source IN ('KEYBOARD', 'STICK')),
    kit_preset_id bigint REFERENCES kit_presets(id) ON DELETE SET NULL,
    kit_preset_snapshot jsonb CHECK (jsonb_typeof(kit_preset_snapshot) = 'object'),
    calibration jsonb CHECK (jsonb_typeof(calibration) = 'object'),
    score integer CHECK (score >= 0),
    accuracy numeric(5,2) CHECK (accuracy BETWEEN 0 AND 100),
    max_combo integer CHECK (max_combo >= 0),
    judgement_counts jsonb CHECK (jsonb_typeof(judgement_counts) = 'object'),
    judgement_context jsonb CHECK (jsonb_typeof(judgement_context) = 'object'),
    live_coach_events jsonb CHECK (jsonb_typeof(live_coach_events) = 'array'),
    consent boolean NOT NULL DEFAULT false,
    raw_log_key varchar(300) CHECK (btrim(raw_log_key) <> ''),
    raw_log_status varchar(10) NOT NULL DEFAULT 'PENDING' CHECK (raw_log_status IN ('PENDING', 'UPLOADED')),
    client_meta jsonb CHECK (jsonb_typeof(client_meta) = 'object'),
    payload_schema_version integer NOT NULL CHECK (payload_schema_version > 0),
    payload_hash varchar(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
    started_at timestamptz NOT NULL,
    ended_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ended_at >= started_at),
    CHECK ((raw_log_status = 'UPLOADED') = (raw_log_key IS NOT NULL)),
    CHECK (
        (mode IN ('RHYTHM', 'SHEET') AND song_id IS NOT NULL
            AND chart_version_id IS NOT NULL AND judgement_context IS NOT NULL)
        OR (mode IN ('FREE', 'TEMPO') AND song_id IS NULL AND chart_version_id IS NULL)
    )
);
CREATE INDEX play_sessions_user_ended_idx ON play_sessions (user_id, ended_at DESC);
CREATE INDEX play_sessions_user_song_ended_idx ON play_sessions (user_id, song_id, ended_at DESC);
CREATE INDEX play_sessions_song_idx ON play_sessions (song_id);
CREATE INDEX play_sessions_chart_version_idx ON play_sessions (chart_version_id);
CREATE INDEX play_sessions_kit_preset_idx ON play_sessions (kit_preset_id);

CREATE TABLE hits (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    play_session_id uuid NOT NULL REFERENCES play_sessions(id) ON DELETE CASCADE,
    seq integer NOT NULL CHECK (seq >= 0),
    -- 소수 ms와 카운트인 중 음수 시각을 보존한다. NaN/무한대는 거부한다.
    t_ms double precision NOT NULL CHECK (t_ms > '-Infinity'::float8 AND t_ms < 'Infinity'::float8),
    stick_id smallint CHECK (stick_id IN (0, 1)),
    pad varchar(10) NOT NULL CHECK (btrim(pad) <> ''),
    baseline_pad varchar(10),
    predicted_pad varchar(10),
    velocity smallint CHECK (velocity BETWEEN 0 AND 127),
    peak_accel real CHECK (peak_accel > '-Infinity'::float4 AND peak_accel < 'Infinity'::float4),
    pitch real CHECK (pitch > '-Infinity'::float4 AND pitch < 'Infinity'::float4),
    yaw real CHECK (yaw > '-Infinity'::float4 AND yaw < 'Infinity'::float4),
    judgement varchar(7) CHECK (judgement IN ('PERFECT', 'GOOD', 'MISS')),
    matched_note_id varchar(64) CHECK (btrim(matched_note_id) <> ''),
    delta_ms double precision CHECK (delta_ms > '-Infinity'::float8 AND delta_ms < 'Infinity'::float8),
    UNIQUE (play_session_id, seq),
    CHECK ((
        (judgement IS NULL AND matched_note_id IS NULL AND delta_ms IS NULL AND velocity IS NOT NULL)
        OR (judgement IN ('PERFECT', 'GOOD') AND matched_note_id IS NOT NULL
            AND delta_ms IS NOT NULL AND velocity IS NOT NULL)
        OR (judgement = 'MISS' AND matched_note_id IS NOT NULL AND delta_ms IS NULL
            AND stick_id IS NULL AND velocity IS NULL AND peak_accel IS NULL
            AND pitch IS NULL AND yaw IS NULL AND baseline_pad IS NULL AND predicted_pad IS NULL)
    ) IS TRUE)
);
CREATE UNIQUE INDEX hits_session_note_idx ON hits (play_session_id, matched_note_id)
    WHERE matched_note_id IS NOT NULL;
