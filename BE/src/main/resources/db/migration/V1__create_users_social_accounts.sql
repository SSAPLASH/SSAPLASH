-- S15P31A307-86 회원·소셜 연동 (ERD 3-1·3-2)
-- 적용된 뒤에는 이 파일을 고치지 않는다. 변경은 다음 번호의 새 파일로 추가한다.
-- 제약 이름 규칙: pk_{table}, fk_{table}_{column}, uq_{table}_{의미}, ck_{table}_{의미}, ix_{table}_{columns}

CREATE TABLE users (
    id                bigint       GENERATED ALWAYS AS IDENTITY,
    nickname          varchar(30)  NOT NULL,
    email             varchar(255),
    profile_image_url varchar(500),
    role              varchar(10)  NOT NULL DEFAULT 'USER',
    status            varchar(10)  NOT NULL DEFAULT 'ACTIVE',
    created_at        timestamptz  NOT NULL DEFAULT now(),
    updated_at        timestamptz  NOT NULL DEFAULT now(),
    withdrawn_at      timestamptz,
    CONSTRAINT pk_users PRIMARY KEY (id),
    CONSTRAINT ck_users_role CHECK (role IN ('USER', 'ADMIN')),
    CONSTRAINT ck_users_status CHECK (status IN ('ACTIVE', 'WITHDRAWN')),
    -- 탈퇴 상태와 탈퇴 시각은 함께 바뀐다.
    CONSTRAINT ck_users_withdrawn_at CHECK ((status = 'WITHDRAWN') = (withdrawn_at IS NOT NULL))
);

COMMENT ON TABLE users IS '회원. 탈퇴해도 행은 지우지 않고 status를 WITHDRAWN으로 바꾸고 개인정보 컬럼을 비운다';
COMMENT ON COLUMN users.email IS '제공자가 준 값. 식별자로 쓰지 않는다';
COMMENT ON COLUMN users.role IS 'USER / ADMIN';
COMMENT ON COLUMN users.status IS 'ACTIVE / WITHDRAWN';

CREATE TABLE social_accounts (
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    user_id          bigint       NOT NULL,
    provider         varchar(20)  NOT NULL,
    provider_user_id varchar(255) NOT NULL,
    email            varchar(255),
    connected_at     timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT pk_social_accounts PRIMARY KEY (id),
    CONSTRAINT fk_social_accounts_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT uq_social_accounts_provider_user UNIQUE (provider, provider_user_id)
);

CREATE INDEX ix_social_accounts_user_id ON social_accounts (user_id);

COMMENT ON TABLE social_accounts IS '소셜 로그인 연동. 회원 1명이 여러 제공자를 연결할 수 있다';
COMMENT ON COLUMN social_accounts.provider IS '제공자 코드. 1단계는 GOOGLE만. 제공자를 늘릴 때 마이그레이션 없이 값만 추가하도록 CHECK를 두지 않는다';
COMMENT ON COLUMN social_accounts.provider_user_id IS '제공자 측 사용자 식별자. 구글은 ID 토큰의 sub';
COMMENT ON COLUMN social_accounts.email IS '제공자 응답 원본. users.email과 별도 보관';
