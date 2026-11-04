-- S15P31A307-258: telemetry_events를 90일 보관한다(Infra 합의 2026-11-04, MONITOR-002).
-- 1일 청크 단위로 범위 끝이 90일보다 오래된 청크를 TimescaleDB 스케줄러가 매일 통째로 지운다.
-- 확장 전용 함수라 일반 PostgreSQL 테스트 복사본에서는 V8과 함께 제외한다(build.gradle).
-- 이미 같은 정책이 있는 DB에서도 실패하지 않도록 if_not_exists를 켠다. 압축 정책은 두지 않는다.
SELECT add_retention_policy('telemetry_events', INTERVAL '90 days', if_not_exists => true);
