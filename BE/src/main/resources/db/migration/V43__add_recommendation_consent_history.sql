-- 추천 학습 동의 이력(229). user_recommendation_consent는 현재 상태만 덮어써서, 철회하면 어떤 판에 언제 동의했는지 사라진다.
-- 추가만 하는 표다. 철회·탈퇴일부터 2년이 지나면 RecommendationConsentHistoryRetention이 지운다.
-- 뷰로 내보내지 않으며 AI 계정에 권한을 주지 않는다.
CREATE TABLE user_recommendation_consent_history (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agreed boolean NOT NULL,
    version varchar(50) NOT NULL CHECK (btrim(version) <> ''),
    recorded_at timestamptz NOT NULL
);
CREATE INDEX user_recommendation_consent_history_user_idx ON user_recommendation_consent_history (user_id, recorded_at);

-- 지금까지의 응답을 첫 이력으로 옮긴다
INSERT INTO user_recommendation_consent_history(user_id, agreed, version, recorded_at)
SELECT user_id, agreed, version, updated_at FROM user_recommendation_consent;
