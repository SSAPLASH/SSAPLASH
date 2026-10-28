-- S15P31A307-152: 텔레메트리 수신 계약(MONITOR-001, 2026-10-27 BE 합의)에 맞춘다.
-- HIHAT_PEDAL(11자)을 받도록 패드 3컬럼을 넓히고, 시계 오프셋의 ms 미만 정밀도를 보존한다.
-- V7이 이름 없이 만든 CHECK는 float4 기준이라 지우고 이름 규칙에 맞춰 다시 만든다.
ALTER TABLE telemetry_events
    ALTER COLUMN pad TYPE varchar(16),
    ALTER COLUMN baseline_pad TYPE varchar(16),
    ALTER COLUMN predicted_pad TYPE varchar(16);

ALTER TABLE telemetry_events DROP CONSTRAINT telemetry_events_clock_offset_ms_check;
ALTER TABLE telemetry_events ALTER COLUMN clock_offset_ms TYPE double precision;
ALTER TABLE telemetry_events ADD CONSTRAINT ck_telemetry_events_clock_offset_ms
    CHECK (clock_offset_ms > '-Infinity'::float8 AND clock_offset_ms < 'Infinity'::float8);
