-- S15P31A307-82: 공용 자체 합성 반주를 기존 비공개 자산 경로로 제공한다.
-- 소유자·라이선스 제약은 유지하고, 곡/자산 키를 자동 연결하지 않는다.
-- V2에서 이름 없이 만든 반주 CHECK의 PostgreSQL 기본 이름은 songs_check1이다.
ALTER TABLE songs DROP CONSTRAINT songs_check1;

ALTER TABLE songs
    ADD CONSTRAINT songs_accompaniment_source_check
    CHECK (accompaniment_key IS NULL OR source IN ('AUDIO', 'BUILTIN'));
