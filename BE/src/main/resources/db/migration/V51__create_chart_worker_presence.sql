-- 채보 워커별 마지막 연락 시각. 워커가 claim이나 heartbeat를 보낼 때마다 갱신한다.
-- 모든 워커의 마지막 연락이 기준 시간보다 오래되면 대기 중인 채보 작업을 WORKER_OFFLINE으로 실패 처리한다.
-- worker_id 형식은 chart_job_attempts.worker_id와 같다.

CREATE TABLE chart_worker_presence (
    worker_id    varchar(128) PRIMARY KEY CHECK (btrim(worker_id) <> ''),
    last_seen_at timestamptz NOT NULL
);
