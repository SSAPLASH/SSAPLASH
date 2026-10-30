-- S15P31A307-156: 공용 곡 공개·비공개 전환. 처리 상태(status)와 섞지 않으려고 별도 컬럼을 둔다.
-- 기존 행은 기본값으로 모두 공개다. 개인 곡은 소유자만 보므로 항상 true로 고정한다.
ALTER TABLE songs ADD COLUMN published boolean NOT NULL DEFAULT true;
ALTER TABLE songs ADD CONSTRAINT songs_published_builtin_check CHECK (source = 'BUILTIN' OR published);
