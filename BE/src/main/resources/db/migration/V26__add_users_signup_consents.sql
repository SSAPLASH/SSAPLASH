-- S15P31A307-199: 가입 동의(이용약관·개인정보 수집·이용·연주 기록 활용)의 판과 동의 시각.
-- 기존 행은 채우지 않는다(동의한 적 없는 사실을 기록하지 않음). 약관·개인정보 동의 시각이 둘 다 있으면 가입 완료다.
ALTER TABLE users ADD COLUMN data_consent_version varchar(50);
ALTER TABLE users ADD COLUMN terms_version varchar(50);
ALTER TABLE users ADD COLUMN terms_agreed_at timestamptz;
ALTER TABLE users ADD COLUMN privacy_version varchar(50);
ALTER TABLE users ADD COLUMN privacy_agreed_at timestamptz;

-- 판 없이 연주 기록 활용 값만 있는 행(V25의 PUT으로 저장된 값, FE 연결 전이라 0건 예상)은 세 값 모두 미설정으로 되돌린다.
UPDATE users SET data_consent = NULL, data_consent_at = NULL
WHERE data_consent_version IS NULL AND (data_consent IS NOT NULL OR data_consent_at IS NOT NULL);

-- 연주 기록 활용: 값·시각·판이 모두 없거나 모두 있다. 판은 빈 값·공백만일 수 없다.
ALTER TABLE users DROP CONSTRAINT ck_users_data_consent;
ALTER TABLE users ADD CONSTRAINT ck_users_data_consent CHECK (
    (data_consent IS NULL AND data_consent_at IS NULL AND data_consent_version IS NULL)
    OR (data_consent IS NOT NULL AND data_consent_at IS NOT NULL AND data_consent_version IS NOT NULL
        AND btrim(data_consent_version) <> ''));

-- 이용약관·개인정보: 판과 동의 시각이 함께 있거나 함께 없다. 판은 빈 값·공백만일 수 없다.
ALTER TABLE users ADD CONSTRAINT ck_users_terms_consent CHECK (
    (terms_version IS NULL AND terms_agreed_at IS NULL)
    OR (terms_version IS NOT NULL AND terms_agreed_at IS NOT NULL AND btrim(terms_version) <> ''));
ALTER TABLE users ADD CONSTRAINT ck_users_privacy_consent CHECK (
    (privacy_version IS NULL AND privacy_agreed_at IS NULL)
    OR (privacy_version IS NOT NULL AND privacy_agreed_at IS NOT NULL AND btrim(privacy_version) <> ''));
