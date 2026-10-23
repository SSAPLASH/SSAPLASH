-- S15P31A307-94: V1의 users(id bigint) 적용 후 실행한다.
-- JSON 내부 악보 형식·노트 식별자·준비 상태의 의미 검증은 등록 API에서 담당한다.
CREATE TABLE songs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_id bigint REFERENCES users(id),
    title varchar(100) NOT NULL,
    artist varchar(100),
    source varchar(10) NOT NULL CHECK (source IN ('BUILTIN', 'MIDI', 'AUDIO')),
    status varchar(12) NOT NULL DEFAULT 'READY' CHECK (status IN ('READY', 'PROCESSING', 'FAILED')),
    bpm numeric(6,2) CHECK (bpm > 0 AND bpm <> 'NaN'::numeric),
    offset_ms integer NOT NULL DEFAULT 0,
    time_signature varchar(5),
    duration_ms integer CHECK (duration_ms >= 0),
    license varchar(200),
    accompaniment_key varchar(300),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CHECK ((source = 'BUILTIN') = (owner_id IS NULL)),
    CHECK (accompaniment_key IS NULL OR source = 'AUDIO'),
    CHECK (source <> 'BUILTIN' OR (license IS NOT NULL AND btrim(license) <> ''))
);

CREATE INDEX songs_owner_created_at_idx ON songs (owner_id, created_at DESC);

CREATE TABLE charts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    song_id bigint NOT NULL REFERENCES songs(id) ON DELETE RESTRICT,
    difficulty varchar(6) NOT NULL CHECK (difficulty IN ('EASY', 'NORMAL', 'HARD')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (song_id, difficulty)
);

CREATE TABLE chart_versions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    chart_id bigint NOT NULL REFERENCES charts(id) ON DELETE RESTRICT,
    version integer NOT NULL CHECK (version > 0),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
    notes jsonb NOT NULL,
    timing jsonb NOT NULL CHECK (jsonb_typeof(timing) = 'object'),
    notation_status varchar(12) NOT NULL CHECK (notation_status IN ('PENDING', 'READY', 'UNAVAILABLE')),
    note_count integer NOT NULL CHECK (note_count >= 0),
    generator varchar(20) NOT NULL CHECK (generator IN ('BUILTIN', 'MIDI_RULE', 'ADT_MODEL', 'MANUAL')),
    generator_version varchar(50),
    sheet_pages jsonb CHECK (sheet_pages IS NULL OR jsonb_typeof(sheet_pages) = 'array'),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (chart_id, version),
    CHECK (CASE WHEN jsonb_typeof(notes) = 'array' THEN jsonb_array_length(notes) = note_count ELSE false END)
);
