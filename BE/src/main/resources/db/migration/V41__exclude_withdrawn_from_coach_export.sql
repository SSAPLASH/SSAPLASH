-- 탈퇴 회원의 연주 기록을 보정 뷰에서 뺀다. V21의 "탈퇴 회원의 동의 세션 포함"을 뒤집는다(229).
-- 탈퇴하면 세션 원본은 WithdrawnPlayCleanup이 지우고, 이미 MLflow 보정 기록에 반영된 익명 집계만 남는다.
-- 삭제가 끝나기 전에 배치가 읽어도 탈퇴자 기록이 나가지 않도록 뷰에서 바로 제외한다.
-- 열과 순서는 V21과 같다. 권한과 security_barrier는 그대로 유지된다.
CREATE OR REPLACE VIEW coach_export_v WITH (security_barrier = true) AS
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
      AND u.status = 'ACTIVE'
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
