-- S15P31A307-97: V7의 데이터를 보존하며 time 기준 1일 청크로 전환한다.
-- TimescaleDB가 설치·preload되지 않은 서버에서는 실패해야 한다.
CREATE EXTENSION IF NOT EXISTS timescaledb;

SELECT create_hypertable(
    'telemetry_events',
    by_range('time', INTERVAL '1 day'),
    migrate_data => true,
    create_default_indexes => false
);

-- 보관 기간·압축 정책은 별도 합의 후 추가한다. 여기서는 데이터를 자동 삭제하지 않는다.
