-- S15P31A307-97: 프리셋 CRUD와 독립적으로 실제 선행 스키마를 제공한다.
CREATE TABLE kit_presets (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name varchar(50) NOT NULL CHECK (btrim(name) <> ''),
    is_default boolean NOT NULL DEFAULT false,
    layout jsonb NOT NULL CHECK (jsonb_typeof(layout) = 'object'),
    sounds jsonb NOT NULL CHECK (jsonb_typeof(sounds) = 'object'),
    tuning jsonb CHECK (jsonb_typeof(tuning) = 'object'),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
);

CREATE UNIQUE INDEX kit_presets_user_default_idx ON kit_presets (user_id) WHERE is_default;
