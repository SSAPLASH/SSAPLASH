-- S15P31A307-97: 실제 배포 기반인 일반 PostgreSQL 16에서 적용한다.
-- TimescaleDB 설치/전환 및 보관 기간에 따른 삭제 정책은 인프라 확정 후 별도 버전으로 적용한다.
-- 플레이 요약보다 먼저 도착할 수 있어 session_id/user_id에 FK를 걸지 않는다.
CREATE TABLE telemetry_events (
    time timestamptz NOT NULL,
    session_id uuid NOT NULL,
    user_id bigint,
    mode varchar(6) CHECK (mode IN ('RHYTHM', 'FREE', 'TEMPO', 'SHEET')),
    kind varchar(8) NOT NULL CHECK (kind IN ('HIT', 'STATUS')),
    stick_id smallint CHECK (stick_id IN (0, 1)),
    pad varchar(10),
    baseline_pad varchar(10),
    predicted_pad varchar(10),
    judgement varchar(7) CHECK (judgement IN ('PERFECT', 'GOOD', 'MISS')),
    delta_ms double precision CHECK (delta_ms > '-Infinity'::float8 AND delta_ms < 'Infinity'::float8),
    velocity smallint CHECK (velocity BETWEEN 0 AND 127),
    t_sensor bigint CHECK (t_sensor >= 0),
    t_recv double precision CHECK (t_recv > '-Infinity'::float8 AND t_recv < 'Infinity'::float8),
    t_judge double precision CHECK (t_judge > '-Infinity'::float8 AND t_judge < 'Infinity'::float8),
    t_audio double precision CHECK (t_audio > '-Infinity'::float8 AND t_audio < 'Infinity'::float8),
    clock_offset_ms real CHECK (clock_offset_ms > '-Infinity'::float4 AND clock_offset_ms < 'Infinity'::float4),
    packet_loss real CHECK (packet_loss >= 0 AND packet_loss < 'Infinity'::float4),
    battery_pct smallint CHECK (battery_pct BETWEEN 0 AND 100),
    tags jsonb CHECK (jsonb_typeof(tags) = 'object')
);
CREATE INDEX telemetry_events_session_time_idx ON telemetry_events (session_id, time);
CREATE INDEX telemetry_events_time_idx ON telemetry_events (time);
