-- 추천 학습 입력에서 학습 활용에 동의하지 않은 세션을 뺀다(229). 보정 뷰(coach_export_v)와 같은 기준이다.
-- 열과 순서는 V37과 같다. 권한과 security_barrier는 그대로 유지된다.
CREATE OR REPLACE VIEW recommend_interactions_v WITH (security_barrier = true) AS
SELECT
    left(encode(sha256(convert_to(current_setting('app.recommend_key_secret') || ':' || u.id::text, 'UTF8')), 'hex'), 32) AS user_key,
    p.song_id,
    v.chart_id,
    p.ended_at AS played_at,
    p.accuracy,
    EXTRACT(EPOCH FROM (p.ended_at - p.started_at)) * 1000 >= 0.8 * s.duration_ms AS completed,
    p.mode
FROM play_sessions p
JOIN user_recommendation_consent c ON c.user_id = p.user_id AND c.agreed
JOIN users u ON u.id = p.user_id AND u.status = 'ACTIVE'
JOIN chart_versions v ON v.id = p.chart_version_id
JOIN recommend_chart_features_v f ON f.chart_id = v.chart_id
JOIN recommend_songs_v s ON s.song_id = p.song_id
WHERE p.mode IN ('RHYTHM', 'SHEET')
  AND p.consent
  AND p.accuracy IS NOT NULL
  AND current_setting('app.recommend_key_secret') <> '';
