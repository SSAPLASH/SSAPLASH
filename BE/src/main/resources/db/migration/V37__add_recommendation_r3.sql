-- 곡 추천 R3 운영 연결: 추천 학습 동의, 후보 저장, AI 배치가 읽는 가명 뷰(설계 문서 부록 C, 요청 문서 COACH-004_R3-후보적재-계약).
-- 뷰 열 목록이 곧 허용 목록이다. 열을 늘리려면 AI와 먼저 합의한다.
-- 접속(LOGIN) 역할과 가명 비밀 값은 여기서 만들지 않는다. Infra가 서버에서 만든다.

-- 행이 없으면 한 번도 응답하지 않은 사용자이고 미동의로 본다. 기존 "연주 기록 활용 동의"와 목적이 다른 별도 항목이다.
CREATE TABLE user_recommendation_consent (
    user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    agreed boolean NOT NULL,
    version varchar(50) NOT NULL CHECK (btrim(version) <> ''),
    updated_at timestamptz NOT NULL
);

-- AI 배치가 만든 사용자별 후보. 철회·탈퇴 때 지운다. 사용자 벡터나 모델 산출물은 저장하지 않는다.
CREATE TABLE recommendation_candidates (
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rank integer NOT NULL CHECK (rank BETWEEN 1 AND 50),
    song_id bigint NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    model_version varchar(64) NOT NULL CHECK (btrim(model_version) <> ''),
    batch_id varchar(64) NOT NULL CHECK (btrim(batch_id) <> ''),
    generated_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, rank),
    UNIQUE (user_id, song_id)
);
CREATE INDEX recommendation_candidates_song_idx ON recommendation_candidates (song_id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'recommend_export_reader') THEN
        CREATE ROLE recommend_export_reader NOLOGIN;
    END IF;
EXCEPTION
    WHEN duplicate_object THEN NULL; -- 동시에 만든 경우
END
$$;

-- user_key = SHA-256(비밀 값 + ":" + user_id)의 16진수 앞 32자. BE의 RecommendationUserKey와 같아야 한다.
-- 비밀 값은 역할 설정(app.recommend_key_secret)으로 받는다. 없으면 오류(42704), 빈 문자열이면 행이 없다.
-- 동의 철회·탈퇴는 다음 읽기부터 바로 빠진다.
CREATE VIEW recommend_users_v WITH (security_barrier = true) AS
SELECT
    left(encode(sha256(convert_to(current_setting('app.recommend_key_secret') || ':' || u.id::text, 'UTF8')), 'hex'), 32) AS user_key,
    true AS consent_recommendation,
    c.version AS consent_version
FROM user_recommendation_consent c
JOIN users u ON u.id = c.user_id
WHERE c.agreed
  AND u.status = 'ACTIVE'
  AND current_setting('app.recommend_key_secret') <> '';

-- 공개 공용 곡만. 개인 곡은 내보내지 않는다.
CREATE VIEW recommend_songs_v WITH (security_barrier = true) AS
SELECT s.id AS song_id, s.bpm, s.duration_ms, s.song_level, true AS public
FROM songs s
WHERE s.source = 'BUILTIN'
  AND s.owner_id IS NULL
  AND s.status = 'READY'
  AND s.published
  AND s.deleted_at IS NULL
  AND s.song_level IS NOT NULL
  AND s.bpm IS NOT NULL
  AND s.duration_ms IS NOT NULL;

-- 채보별 최신 버전의 특징. 리듬 격자를 아직 계산하지 않은 채보는 제외 표시로 내보낸다(AI 로더 규격).
CREATE VIEW recommend_chart_features_v WITH (security_barrier = true) AS
SELECT
    c.id AS chart_id,
    c.song_id,
    c.difficulty,
    f.avg_notes_per_sec,
    f.peak_notes_2s,
    f.pad_ratio::text AS pad_ratio,
    f.transition_ratio::text AS transition_ratio,
    COALESCE(f.rhythm_grid, '{"excluded": "NOT_COMPUTED"}'::jsonb)::text AS rhythm_grid
FROM recommend_songs_v s
JOIN charts c ON c.song_id = s.song_id
JOIN chart_versions v ON v.id = (SELECT x.id FROM chart_versions x WHERE x.chart_id = c.id ORDER BY x.version DESC LIMIT 1)
JOIN chart_features f ON f.chart_version_id = v.id;

-- 옛 채보 버전의 연주도 채보 id로 묶는다. completed는 연주 시간이 곡 길이의 80% 이상인 판이다.
CREATE VIEW recommend_interactions_v WITH (security_barrier = true) AS
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
  AND p.accuracy IS NOT NULL
  AND current_setting('app.recommend_key_secret') <> '';

-- 그룹 역할에는 이 스키마 USAGE와 뷰 SELECT만 준다. 원본 테이블에는 아무 권한도 주지 않는다.
DO $$
BEGIN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO recommend_export_reader', current_schema());
END
$$;
GRANT SELECT ON recommend_users_v, recommend_songs_v, recommend_chart_features_v, recommend_interactions_v TO recommend_export_reader;
