-- 측정 세션 실험 조건(259번, 설계 .claude/plans/MONITOR-002-측정-세션-실험-조건.md).
-- FE 회신(MONITOR-002, 2026-11-06)의 7개 필드를 (user_id, session_id)당 한 행으로 둔다. 배치 외피 conditions가 올 때마다
-- 행 전체를 마지막 값으로 바꾸고(TelemetrySessionConditionsRepository), conditions가 없는 배치는 행을 건드리지 않는다.
-- telemetry_events처럼 FK를 두지 않는다(플레이 요약보다 먼저 올 수 있고 users 행은 탈퇴 뒤에도 남는다). 탈퇴 때 WithdrawalService가 지운다.
-- 보관 정책은 두지 않는다(세션당 한 행, 수백 바이트). 이벤트가 90일 뒤 지워지면 세션 목록에서는 보이지 않는다.
CREATE TABLE telemetry_session_conditions (
    user_id bigint NOT NULL,
    session_id uuid NOT NULL,
    firmware_0 varchar(64),
    firmware_1 varchar(64),
    dongle_firmware varchar(64),
    link_mask smallint CHECK (link_mask BETWEEN 0 AND 15),
    haptic_enable boolean,
    sensor_mount varchar(16) CHECK (sensor_mount IN ('GRIP_FRONT', 'BENCH')),
    app_build varchar(64),
    note varchar(200),
    received_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, session_id)
);
