-- R3 가명 키를 비밀 값 해시에서 무작위 대체 키로 바꾼다(229).
-- 해시는 배치 계정이 비밀 값을 읽을 수 있고 user_id가 작은 정수라 전수 대입으로 키와 사용자를 맞출 수 있었다.
-- 키는 user_id에서 계산되지 않는다. 대응표는 뷰가 소유자 권한으로만 읽고, 배치 역할에는 권한을 주지 않는다.
-- 동의할 때 만들고 철회·탈퇴하면 지운다. 다시 동의하면 새 키가 되어 이전 기록과 이어지지 않는다.
CREATE TABLE recommendation_user_keys (
    user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    user_key text NOT NULL UNIQUE CHECK (user_key ~ '^[0-9a-f]{32}$'),
    created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO recommendation_user_keys(user_id, user_key)
SELECT c.user_id, replace(gen_random_uuid()::text, '-', '')
FROM user_recommendation_consent c
JOIN users u ON u.id = c.user_id
WHERE c.agreed AND u.status = 'ACTIVE';

-- 열과 순서는 V37과 같다. 권한과 security_barrier는 그대로 유지된다.
CREATE OR REPLACE VIEW recommend_users_v WITH (security_barrier = true) AS
SELECT
    k.user_key,
    true AS consent_recommendation,
    c.version AS consent_version
FROM user_recommendation_consent c
JOIN users u ON u.id = c.user_id
JOIN recommendation_user_keys k ON k.user_id = c.user_id
WHERE c.agreed
  AND u.status = 'ACTIVE';

CREATE OR REPLACE VIEW recommend_interactions_v WITH (security_barrier = true) AS
SELECT
    k.user_key,
    p.song_id,
    v.chart_id,
    p.ended_at AS played_at,
    p.accuracy,
    EXTRACT(EPOCH FROM (p.ended_at - p.started_at)) * 1000 >= 0.8 * s.duration_ms AS completed,
    p.mode
FROM play_sessions p
JOIN user_recommendation_consent c ON c.user_id = p.user_id AND c.agreed
JOIN users u ON u.id = p.user_id AND u.status = 'ACTIVE'
JOIN recommendation_user_keys k ON k.user_id = p.user_id
JOIN chart_versions v ON v.id = p.chart_version_id
JOIN recommend_chart_features_v f ON f.chart_id = v.chart_id
JOIN recommend_songs_v s ON s.song_id = p.song_id
WHERE p.mode IN ('RHYTHM', 'SHEET')
  AND p.consent
  AND p.accuracy IS NOT NULL;
