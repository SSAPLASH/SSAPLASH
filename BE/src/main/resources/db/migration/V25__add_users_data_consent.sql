-- S15P31A307-199: 회원 계정 단위 연주 기록 활용 동의(선택). 값이 없으면 null이라 「한 번도 답하지 않음」과 「거부(false)」를 구분한다.
-- 기존 행은 모두 null로 둔다. 값과 선택 시각은 함께 있거나 함께 없어야 한다.
ALTER TABLE users ADD COLUMN data_consent boolean;
ALTER TABLE users ADD COLUMN data_consent_at timestamptz;
ALTER TABLE users ADD CONSTRAINT ck_users_data_consent CHECK ((data_consent IS NULL) = (data_consent_at IS NULL));
