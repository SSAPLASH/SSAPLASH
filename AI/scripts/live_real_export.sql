-- 연주 중 LLM 실제 기록 평가용 1회성 내보내기 (설계 COACH-001 각도·실측평가 3.4, 4.3).
-- EC2 postgres 컨테이너 안에서 psql로 실행한다. 실행 방법은 AI/docs/live-coach-llm.md "실제 기록 평가".
--
-- 대상: 팀 내부·시험 계정(:ids)의 연주 중 데이터 활용에 동의한 판(consent), RHYTHM·SHEET, 공개 곡,
--       활성 계정, ADMIN 제외(비식별 내보내기 뷰 coach_export_v와 같은 기준).
-- 내보내지 않는 것: 회원 번호, 이메일, 닉네임, 원래 판 번호(uuid). 판 번호는 이번 실행에서만 쓰는 무작위 소금으로
--       해시한 session_key로 바꾸고, 소금은 어디에도 남기지 않는다(같은 판을 다시 찾아갈 수 없다).
-- 결과: 컨테이너 /tmp/live-real/{sessions,hits,charts}.csv

\set ON_ERROR_STOP on

CREATE TEMP TABLE live_real_ex AS
WITH salt AS (SELECT gen_random_uuid()::text AS s)
SELECT ps.id,
       encode(sha256(convert_to(ps.id::text || salt.s, 'UTF8')), 'hex') AS session_key,
       ps.input_source,
       ps.chart_version_id AS chart_version_ref,
       (ps.judgement_context -> 'timingWindows' ->> 'perfectMs')::double precision AS perfect_ms,
       (ps.judgement_context -> 'timingWindows' ->> 'goodMs')::double precision AS good_ms,
       ps.calibration -> 'pads' AS pad_poses,
       ps.live_coach_events,
       (ps.created_at AT TIME ZONE 'Asia/Seoul')::date AS played_date
FROM play_sessions ps
JOIN users u ON u.id = ps.user_id
JOIN songs s ON s.id = ps.song_id
CROSS JOIN salt
WHERE ps.consent
  AND ps.mode IN ('RHYTHM', 'SHEET')
  AND ps.judgement_context IS NOT NULL
  AND ps.chart_version_id IS NOT NULL
  AND s.owner_id IS NULL
  AND u.role <> 'ADMIN'
  AND u.status = 'ACTIVE'
  AND ps.user_id IN (:ids);

SELECT count(*) AS plays, count(DISTINCT chart_version_ref) AS charts FROM live_real_ex;

\copy (SELECT session_key, input_source, chart_version_ref, perfect_ms, good_ms, pad_poses, live_coach_events, played_date FROM live_real_ex ORDER BY played_date, session_key) TO '/tmp/live-real/sessions.csv' WITH (FORMAT csv, HEADER)
\copy (SELECT e.session_key, h.seq, h.t_ms, h.stick_id, h.pad, h.judgement, h.matched_note_id, h.delta_ms, h.velocity, h.pitch, h.yaw FROM live_real_ex e JOIN hits h ON h.play_session_id = e.id ORDER BY e.session_key, h.seq) TO '/tmp/live-real/hits.csv' WITH (FORMAT csv, HEADER)
\copy (SELECT v.id AS chart_version_ref, v.notes, v.timing FROM chart_versions v WHERE v.id IN (SELECT DISTINCT chart_version_ref FROM live_real_ex) ORDER BY v.id) TO '/tmp/live-real/charts.csv' WITH (FORMAT csv, HEADER)
