-- 연습 추천(COACH-004): 약점에 맞는 곡 추천의 노출을 같은 테이블에 기록한다. context에 DRILL을 허용한다.
ALTER TABLE recommendation_items DROP CONSTRAINT recommendation_items_context_check;
ALTER TABLE recommendation_items
    ADD CONSTRAINT recommendation_items_context_check CHECK (context IN ('SONG_PICKER', 'REPORT', 'SIMILAR', 'DRILL'));
