-- 약점 분석 보정용 비식별 내보내기 뷰와 그 뷰만 읽는 그룹 역할 (COACH-003, AI 요청 139 / BE 142).
-- 뷰 열 목록이 곧 허용 목록이다. 열을 늘리려면 AI와 먼저 합의한다.
-- 접속(LOGIN) 역할·비밀번호·소금은 여기서 만들지 않는다. Infra가 서버에서 만든다(BE README 참고).

-- 역할은 DB가 아니라 클러스터 전역이다. 같은 클러스터의 다른 DB·스키마에서 다시 적용해도 깨지지 않게 한다.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'coach_export_reader') THEN
        CREATE ROLE coach_export_reader NOLOGIN;
    END IF;
EXCEPTION
    WHEN duplicate_object THEN NULL; -- 동시에 만든 경우
END
$$;

-- 행 조건: 동의 세션 · 분석 대상 모드(RHYTHM/SHEET) · ADMIN(팀원) 제외 · 사용자당 최근 10개.
-- 탈퇴 회원의 동의 세션은 포함한다(탈퇴 시 consent=true 세션을 남기는 목적이 분석 활용이다).
-- user_id는 순위 계산에만 쓰고 내보내지 않는다.
-- 소금(app.export_salt) 확인은 열 계산이 아니라 행 조건에 둔다. 쓰지 않는 열은 계산되지 않아 count(*) 같은 조회가
-- 소금 없이 통과하기 때문이다. 소금이 없으면 오류(42704), 빈 문자열이면 행이 없다.
-- security_barrier: 조회 쪽 조건·함수가 행 조건 아래로 내려가 걸러진 행을 엿보지 못하게 한다.
CREATE VIEW coach_export_v WITH (security_barrier = true) AS
WITH ranked AS (
    SELECT ps.id, ps.song_id, ps.chart_version_id, ps.mode, ps.input_source, ps.judgement_context,
           ps.payload_schema_version, ps.created_at,
           row_number() OVER (PARTITION BY ps.user_id ORDER BY ps.ended_at DESC, ps.id) AS recent_rank
    FROM play_sessions ps
    JOIN users u ON u.id = ps.user_id
    WHERE ps.consent
      AND ps.mode IN ('RHYTHM', 'SHEET')
      AND ps.judgement_context IS NOT NULL
      AND u.role <> 'ADMIN'
      AND current_setting('app.export_salt') <> ''
)
SELECT
    encode(sha256(convert_to(r.id::text || current_setting('app.export_salt'), 'UTF8')), 'hex') AS session_key,
    r.mode,
    r.input_source,
    CASE WHEN s.owner_id IS NULL THEN r.song_id END AS song_ref,
    CASE WHEN s.owner_id IS NULL THEN 'PUBLIC' ELSE 'PRIVATE' END AS song_origin,
    (r.judgement_context -> 'timingWindows' ->> 'perfectMs')::double precision AS perfect_ms,
    (r.judgement_context -> 'timingWindows' ->> 'goodMs')::double precision AS good_ms,
    c.difficulty,
    (r.created_at AT TIME ZONE 'Asia/Seoul')::date AS played_date,
    r.payload_schema_version,
    h.seq,
    h.t_ms,
    h.stick_id,
    h.pad,
    h.velocity,
    h.peak_accel,
    h.judgement,
    h.matched_note_id,
    h.delta_ms
FROM ranked r
JOIN songs s ON s.id = r.song_id
JOIN chart_versions v ON v.id = r.chart_version_id
JOIN charts c ON c.id = v.chart_id
JOIN hits h ON h.play_session_id = r.id
WHERE r.recent_rank <= 10;

-- 그룹 역할에는 이 스키마 USAGE와 뷰 SELECT만 준다. 원본 테이블·시퀀스에는 아무 권한도 주지 않는다.
-- 스키마 이름은 적용 대상(운영 public, 테스트 격리 스키마)에 따라 다르므로 현재 스키마로 정한다.
DO $$
BEGIN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO coach_export_reader', current_schema());
END
$$;
GRANT SELECT ON coach_export_v TO coach_export_reader;
