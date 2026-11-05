-- 곡 추천 R2: 비슷한 곡의 노출을 같은 테이블에 기록한다. context에 SIMILAR를 허용하고, 어떤 곡을 기준으로 보여 줬는지 남긴다.
-- V34의 context 제약은 이름 없이 만들었으므로 정의로 찾아서 지운다.
DO $$
DECLARE c record;
BEGIN
    FOR c IN SELECT conname FROM pg_constraint
             WHERE conrelid = 'recommendation_items'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%SONG_PICKER%'
    LOOP
        EXECUTE format('ALTER TABLE recommendation_items DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

ALTER TABLE recommendation_items
    ADD CONSTRAINT recommendation_items_context_check CHECK (context IN ('SONG_PICKER', 'REPORT', 'SIMILAR')),
    ADD COLUMN source_song_id bigint REFERENCES songs(id) ON DELETE SET NULL;
